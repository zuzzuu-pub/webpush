"""
Backend Web Push Implementation Example for Windows 10 Compatibility

This module demonstrates how to send Web Push notifications that work on Windows 10.
It uses the pywebpush library to send notifications via the Web Push Protocol,
which properly wakes service workers on Windows 10 (unlike Socket.IO postMessage).

Installation:
    pip install pywebpush

Usage:
    from backend_webpush_example import WebPushNotificationService
    
    # Initialize service
    push_service = WebPushNotificationService(
        vapid_private_key="YOUR_PRIVATE_KEY",
        vapid_public_key="YOUR_PUBLIC_KEY",
        vapid_claims={"sub": "mailto:your-email@example.com"}
    )
    
    # Send notification
    push_service.send_notification(
        subscription_info=subscriber_push_subscription,
        title="Test Notification",
        message="This works on Windows 10!",
        url="https://example.com"
    )
"""

import json
import logging
from typing import Dict, Any, Optional, List
from datetime import datetime
from pywebpush import webpush, WebPushException

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class WebPushNotificationService:
    """
    Service for sending Web Push notifications that work on Windows 10.
    
    This service handles:
    - Sending notifications via Web Push Protocol (wakes SW on Windows 10)
    - Managing push subscriptions
    - Handling errors and retries
    - Supporting both individual and batch notifications
    """
    
    def __init__(
        self,
        vapid_private_key: str,
        vapid_public_key: str,
        vapid_claims: Dict[str, str]
    ):
        """
        Initialize the Web Push notification service.
        
        Args:
            vapid_private_key: VAPID private key (base64url encoded)
            vapid_public_key: VAPID public key (base64url encoded)
            vapid_claims: VAPID claims dict, must include 'sub' with mailto: URL
                         Example: {"sub": "mailto:your-email@example.com"}
        """
        self.vapid_private_key = vapid_private_key
        self.vapid_public_key = vapid_public_key
        self.vapid_claims = vapid_claims
        
        logger.info("WebPushNotificationService initialized")
    
    def send_notification(
        self,
        subscription_info: Dict[str, Any],
        title: str,
        message: str,
        url: Optional[str] = None,
        icon: Optional[str] = None,
        image: Optional[str] = None,
        badge: Optional[str] = None,
        tag: Optional[str] = None,
        data: Optional[Dict[str, Any]] = None,
        ttl: int = 86400  # 24 hours default
    ) -> bool:
        """
        Send a Web Push notification to a single subscriber.
        
        This will wake the service worker on Windows 10 and display the notification.
        
        Args:
            subscription_info: Push subscription object from client
                {
                    "endpoint": "https://...",
                    "keys": {
                        "p256dh": "...",
                        "auth": "..."
                    }
                }
            title: Notification title
            message: Notification body/message
            url: URL to open when notification is clicked
            icon: Small icon URL
            image: Large image URL (displayed in notification)
            badge: Badge icon URL
            tag: Notification tag for grouping/replacing
            data: Additional custom data
            ttl: Time to live in seconds (how long push server should store)
        
        Returns:
            bool: True if notification sent successfully, False otherwise
        """
        try:
            # Prepare notification payload
            notification_data = {
                "notification": {
                    "title": title,
                    "body": message,
                    "icon": icon or "https://res.cloudinary.com/do5wahloo/image/upload/v1746001971/zuzzuu/vhrhfihk5t6sawer0bhw.svg",
                    "badge": badge or icon,
                    "tag": tag or f"zuzzuu-{datetime.now().timestamp()}",
                    "requireInteraction": False,
                    "silent": False,
                    "vibrate": [200, 100, 200]
                },
                "data": {
                    "url": url or "/",
                    "timestamp": datetime.now().isoformat(),
                    **(data or {})
                }
            }
            
            # Add image if provided
            if image:
                notification_data["notification"]["image"] = image
            
            # Convert to JSON string
            payload = json.dumps(notification_data)
            
            # Send Web Push notification
            response = webpush(
                subscription_info=subscription_info,
                data=payload,
                vapid_private_key=self.vapid_private_key,
                vapid_claims=self.vapid_claims,
                ttl=ttl
            )
            
            logger.info(
                f"✅ Web Push notification sent successfully. "
                f"Status: {response.status_code}, Title: '{title}'"
            )
            return True
            
        except WebPushException as e:
            logger.error(f"❌ Web Push error: {e}")
            
            # Handle specific error cases
            if e.response and e.response.status_code == 410:
                # Subscription expired or invalid
                logger.warning(f"⚠️ Push subscription expired: {subscription_info.get('endpoint', 'unknown')}")
                # TODO: Remove this subscription from database
            elif e.response and e.response.status_code == 404:
                logger.warning(f"⚠️ Push subscription not found: {subscription_info.get('endpoint', 'unknown')}")
                # TODO: Remove this subscription from database
            else:
                logger.error(f"Web Push exception details: {str(e)}")
            
            return False
            
        except Exception as e:
            logger.error(f"❌ Unexpected error sending Web Push: {e}")
            return False
    
    def send_batch_notifications(
        self,
        subscribers: List[Dict[str, Any]],
        title: str,
        message: str,
        **kwargs
    ) -> Dict[str, int]:
        """
        Send the same notification to multiple subscribers.
        
        Args:
            subscribers: List of subscriber objects with push_subscription field
            title: Notification title
            message: Notification message
            **kwargs: Additional arguments passed to send_notification
        
        Returns:
            Dict with 'success' and 'failed' counts
        """
        results = {"success": 0, "failed": 0, "expired": []}
        
        logger.info(f"📤 Sending batch notifications to {len(subscribers)} subscribers...")
        
        for subscriber in subscribers:
            subscription_info = subscriber.get("push_subscription")
            
            if not subscription_info:
                logger.warning(f"⚠️ Subscriber {subscriber.get('id', 'unknown')} has no push subscription")
                results["failed"] += 1
                continue
            
            success = self.send_notification(
                subscription_info=subscription_info,
                title=title,
                message=message,
                **kwargs
            )
            
            if success:
                results["success"] += 1
            else:
                results["failed"] += 1
                results["expired"].append(subscriber.get("id"))
        
        logger.info(
            f"📊 Batch notification results: "
            f"{results['success']} sent, {results['failed']} failed"
        )
        
        return results
    
    def test_notification(self, subscription_info: Dict[str, Any]) -> bool:
        """
        Send a test notification to verify the setup works.
        
        Args:
            subscription_info: Push subscription to test
        
        Returns:
            bool: True if test successful
        """
        return self.send_notification(
            subscription_info=subscription_info,
            title="🧪 Test Notification - Windows 10 Compatible",
            message="If you see this, Web Push is working correctly on Windows 10!",
            url="https://example.com",
            tag="zuzzuu-test"
        )


# FastAPI Integration Example
class FastAPIWebPushIntegration:
    """
    Example integration with FastAPI endpoints.
    
    Add these endpoints to your FastAPI application to:
    1. Store push subscriptions from clients
    2. Send notifications via Web Push
    """
    
    @staticmethod
    def create_endpoints(app, push_service: WebPushNotificationService):
        """
        Add Web Push endpoints to FastAPI app.
        
        Usage:
            from fastapi import FastAPI
            app = FastAPI()
            FastAPIWebPushIntegration.create_endpoints(app, push_service)
        """
        from fastapi import HTTPException
        from pydantic import BaseModel
        
        class PushSubscription(BaseModel):
            subscriber_id: str
            endpoint: str
            keys: Dict[str, str]
            user_agent: Optional[str] = None
            browser_info: Optional[Dict[str, str]] = None
        
        class NotificationRequest(BaseModel):
            subscriber_id: str
            title: str
            message: str
            url: Optional[str] = None
            image: Optional[str] = None
        
        @app.post("/api/v1/push/subscribe")
        async def subscribe_to_push(subscription: PushSubscription):
            """
            Store push subscription from client.
            This endpoint is called by client's sendPushSubscriptionToServer().
            """
            try:
                # TODO: Store subscription in your database
                # Example:
                # await db.subscribers.update(
                #     {"subscriber_id": subscription.subscriber_id},
                #     {"$set": {"push_subscription": subscription.dict()}}
                # )
                
                logger.info(f"✅ Push subscription stored for {subscription.subscriber_id}")
                
                return {
                    "success": True,
                    "message": "Push subscription stored successfully",
                    "data": {"subscriber_id": subscription.subscriber_id}
                }
            except Exception as e:
                logger.error(f"❌ Failed to store push subscription: {e}")
                raise HTTPException(status_code=500, detail=str(e))
        
        @app.post("/api/v1/push/send")
        async def send_push_notification(notification: NotificationRequest):
            """
            Send Web Push notification to a subscriber.
            This is what triggers notifications on Windows 10.
            """
            try:
                # TODO: Retrieve subscription from database
                # Example:
                # subscriber = await db.subscribers.find_one(
                #     {"subscriber_id": notification.subscriber_id}
                # )
                # subscription_info = subscriber.get("push_subscription")
                
                # For demo, using placeholder
                subscription_info = None  # Get from database
                
                if not subscription_info:
                    raise HTTPException(
                        status_code=404,
                        detail=f"No push subscription found for subscriber {notification.subscriber_id}"
                    )
                
                success = push_service.send_notification(
                    subscription_info=subscription_info,
                    title=notification.title,
                    message=notification.message,
                    url=notification.url,
                    image=notification.image
                )
                
                if success:
                    return {
                        "success": True,
                        "message": "Notification sent successfully"
                    }
                else:
                    raise HTTPException(
                        status_code=500,
                        detail="Failed to send notification"
                    )
                    
            except HTTPException:
                raise
            except Exception as e:
                logger.error(f"❌ Error sending push notification: {e}")
                raise HTTPException(status_code=500, detail=str(e))
        
        @app.post("/api/v1/push/test")
        async def test_push_notification(data: Dict[str, str]):
            """
            Test endpoint to verify Web Push works.
            """
            subscriber_id = data.get("subscriber_id")
            
            if not subscriber_id:
                raise HTTPException(status_code=400, detail="subscriber_id required")
            
            # TODO: Get subscription from database
            subscription_info = None  # Get from database
            
            if not subscription_info:
                raise HTTPException(
                    status_code=404,
                    detail=f"No push subscription found for subscriber {subscriber_id}"
                )
            
            success = push_service.test_notification(subscription_info)
            
            if success:
                return {
                    "success": True,
                    "message": "Test notification sent successfully"
                }
            else:
                raise HTTPException(
                    status_code=500,
                    detail="Failed to send test notification"
                )


# Usage Example
if __name__ == "__main__":
    # Example: Initialize the service
    push_service = WebPushNotificationService(
        vapid_private_key="YOUR_VAPID_PRIVATE_KEY",  # From vapid-keys.json
        vapid_public_key="YOUR_VAPID_PUBLIC_KEY",    # From vapid-keys.json
        vapid_claims={"sub": "mailto:your-email@example.com"}
    )
    
    # Example: Send a notification
    example_subscription = {
        "endpoint": "https://fcm.googleapis.com/fcm/send/...",
        "keys": {
            "p256dh": "client_public_key...",
            "auth": "client_auth_secret..."
        }
    }
    
    success = push_service.send_notification(
        subscription_info=example_subscription,
        title="Windows 10 Compatible Notification",
        message="This notification will wake the service worker on Windows 10!",
        url="https://example.com",
        image="https://example.com/image.jpg"
    )
    
    if success:
        print("✅ Notification sent successfully!")
    else:
        print("❌ Failed to send notification")