# Fix Linode Configuration

## Current Problem

Your `.env` file has:
```
S3_LOCATION=US, Chicago, IL: us-ord-1.linodeobjects.com
```

This is the **region endpoint**, not your bucket name!

## What You Need

`S3_LOCATION` should be your **bucket name only**.

### How to Find Your Bucket Name

1. Go to https://cloud.linode.com
2. Click **Object Storage** → **Buckets**
3. Look for your bucket in the Chicago region
4. The bucket name is something like:
   - `my-restaurant-media`
   - `madladslab-uploads`
   - `your-company-name`
   - etc.

It's **NOT** the full URL, just the name!

## Fix Your .env

Edit `/srv/madladslab/.env` and change this line:

**WRONG:**
```bash
S3_LOCATION=US, Chicago, IL: us-ord-1.linodeobjects.com
```

**CORRECT:**
```bash
S3_LOCATION=your-actual-bucket-name
```

### Example

If your bucket is named `madladslab-media`, your .env should have:
```bash
S3_LOCATION=madladslab-media
LINODE_ACCESS=your-access-key
LINODE_SECRET=your-secret-key
```

## After Fixing

1. Save the .env file
2. Restart your app (nodemon should auto-restart)
3. Run: `node test-linode-config.js`
4. Try uploading an image at `/backOffice/recipes`

## Don't Have a Bucket Yet?

Create one:
1. Go to https://cloud.linode.com/object-storage/buckets
2. Click **Create Bucket**
3. Choose:
   - **Region**: Chicago, IL (us-ord-1)
   - **Label**: Whatever you want (e.g., `madladslab-media`)
4. Click **Create Bucket**
5. Copy the label/name to your .env as `S3_LOCATION`

## Need Help?

The bucket name is shown in your Linode dashboard under Object Storage.
It's just the name, not the full URL!
