import dotenv from 'dotenv';
dotenv.config();

console.log('\n=== Linode Environment Check ===\n');
console.log('LINODE_ACCESS:', process.env.LINODE_ACCESS || 'NOT SET');
console.log('LINODE_SECRET:', process.env.LINODE_SECRET || 'NOT SET');
console.log('S3_LOCATION:', process.env.S3_LOCATION || 'NOT SET');
console.log('');

if (process.env.LINODE_ACCESS) {
  console.log('LINODE_ACCESS length:', process.env.LINODE_ACCESS.length);
  const trimmed = process.env.LINODE_ACCESS.trim();
  if (trimmed !== process.env.LINODE_ACCESS) {
    console.log('⚠️ LINODE_ACCESS has leading/trailing whitespace!');
  }
}

if (process.env.LINODE_SECRET) {
  console.log('LINODE_SECRET length:', process.env.LINODE_SECRET.length);
  const trimmed = process.env.LINODE_SECRET.trim();
  if (trimmed !== process.env.LINODE_SECRET) {
    console.log('⚠️ LINODE_SECRET has leading/trailing whitespace!');
  }
}

console.log('');

// Test with sample credentials format
if (process.env.LINODE_ACCESS && process.env.LINODE_SECRET) {
  import('@aws-sdk/client-s3').then(({ S3Client, ListBucketsCommand }) => {
    const client = new S3Client({
      endpoint: 'https://us-ord-1.linodeobjects.com',
      region: 'us-ord-1',
      credentials: {
        accessKeyId: process.env.LINODE_ACCESS.trim(),
        secretAccessKey: process.env.LINODE_SECRET.trim(),
      },
    });

    console.log('Testing connection...');
    const command = new ListBucketsCommand({});

    client.send(command)
      .then(response => {
        console.log('✅ Success! Your buckets:');
        response.Buckets.forEach(b => {
          console.log('  -', b.Name);
        });
        console.log('');
        console.log('Update .env with:');
        console.log('S3_LOCATION=<one-of-the-bucket-names-above>');
      })
      .catch(error => {
        console.log('❌ Connection failed:', error.name);
        console.log('   Message:', error.message);
        console.log('');
        console.log('Possible issues:');
        console.log('  1. Invalid access key or secret key');
        console.log('  2. Keys have expired');
        console.log('  3. Network/firewall blocking connection');
        console.log('');
        console.log('To fix: Generate new access keys in Linode Cloud Manager');
        console.log('  → Object Storage → Access Keys → Create Access Key');
      });
  });
}
