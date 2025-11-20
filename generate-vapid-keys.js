/**
 * VAPID Key Generator for Web Push Notifications
 * 
 * This script generates a pair of VAPID keys (public and private)
 * required for Web Push notifications to work on Windows 10 and other platforms.
 * 
 * Usage:
 *   node generate-vapid-keys.js
 * 
 * The keys will be saved to vapid-keys.json and displayed in the console.
 */

const crypto = require('crypto');
const fs = require('fs');

/**
 * Generate VAPID keys using Node.js crypto
 */
function generateVAPIDKeys() {
  // Generate EC key pair using prime256v1 curve (required for VAPID)
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
    publicKeyEncoding: {
      type: 'spki',
      format: 'der'
    },
    privateKeyEncoding: {
      type: 'pkcs8',
      format: 'der'
    }
  });

  // Convert to base64url format (required by Web Push)
  const publicKeyBase64Url = urlBase64(publicKey);
  const privateKeyBase64Url = urlBase64(privateKey);

  return {
    publicKey: publicKeyBase64Url,
    privateKey: privateKeyBase64Url
  };
}

/**
 * Convert buffer to URL-safe base64 string
 */
function urlBase64(buffer) {
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

/**
 * Main execution
 */
function main() {
  console.log('🔑 Generating VAPID keys for Web Push...\n');

  try {
    const keys = generateVAPIDKeys();

    // Save to file
    const keysData = {
      publicKey: keys.publicKey,
      privateKey: keys.privateKey,
      generatedAt: new Date().toISOString(),
      contact: 'mailto:your-email@example.com', // Change this!
      usage: {
        publicKey: 'Use this in your client-side JavaScript (zuzzuu-notification.js)',
        privateKey: 'Use this in your backend server (KEEP SECRET!)'
      }
    };

    fs.writeFileSync('vapid-keys.json', JSON.stringify(keysData, null, 2));

    console.log('✅ VAPID keys generated successfully!\n');
    console.log('📋 Keys saved to: vapid-keys.json\n');
    console.log('🔓 PUBLIC KEY (use in client):');
    console.log(keys.publicKey);
    console.log('\n🔐 PRIVATE KEY (use in server, KEEP SECRET):');
    console.log(keys.privateKey);
    console.log('\n⚠️  IMPORTANT:');
    console.log('1. Add the PUBLIC KEY to your zuzzuu-notification.js configuration');
    console.log('2. Add the PRIVATE KEY to your backend server environment variables');
    console.log('3. NEVER commit vapid-keys.json to version control!');
    console.log('4. Update the contact email in vapid-keys.json\n');

    // Create .gitignore entry reminder
    console.log('💡 Add to your .gitignore:');
    console.log('vapid-keys.json');
    console.log('');

  } catch (error) {
    console.error('❌ Error generating VAPID keys:', error.message);
    process.exit(1);
  }
}

// Run the script
if (require.main === module) {
  main();
}

module.exports = { generateVAPIDKeys, urlBase64 };