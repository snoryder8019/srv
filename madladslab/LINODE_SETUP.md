# Linode Object Storage Setup Guide

## Current Status

Your recipe management system is configured to use **Linode Object Storage** in the **Chicago, IL region** (`us-ord-1`).

✅ **Development Mode Active**: Images are currently being saved locally to `/srv/madladslab/public/uploads/`

## What You Have

- ✅ AWS S3 SDK installed (`@aws-sdk/client-s3`)
- ✅ Upload system configured for Chicago region
- ✅ Local fallback for development
- ✅ Recipe forms with image upload
- ✅ Drag & drop support

## To Enable Production Linode Storage

### Step 1: Get Your Linode Credentials

1. Log in to [Linode Cloud Manager](https://cloud.linode.com)
2. Go to **Object Storage** → **Buckets**
3. If you don't have a bucket, create one:
   - Click **Create Bucket**
   - Region: **Chicago, IL (us-ord-1)**
   - Bucket Name: Choose a unique name (e.g., `my-restaurant-media`)
4. Go to **Object Storage** → **Access Keys**
5. Click **Create Access Key**
6. Copy your:
   - **Access Key** (looks like: `ABCDEFGHIJKLMNOP1234`)
   - **Secret Key** (looks like: `aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789AbCd`)

### Step 2: Add to Your .env File

Edit `/srv/madladslab/.env` and add these three lines:

```bash
# Linode Object Storage (Chicago, IL - us-ord-1)
S3_LOCATION=your-bucket-name
LINODE_ACCESS=your-access-key
LINODE_SECRET=your-secret-key
```

**Example:**
```bash
S3_LOCATION=my-restaurant-media
LINODE_ACCESS=ABCDEFGHIJKLMNOP1234
LINODE_SECRET=aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789AbCd
```

### Step 3: Restart Your Application

```bash
# However you normally restart your app
# For example:
pm2 restart madladslab
# or
npm restart
# or nodemon will auto-restart
```

### Step 4: Test Configuration

Run the test script:

```bash
node test-linode-config.js
```

You should see:
```
✅ Linode Object Storage is CONFIGURED
```

### Step 5: Test Upload

1. Go to `http://your-domain/backOffice/recipes`
2. Click **Create Recipe** tab
3. Try uploading an image
4. Check your Linode bucket - the image should appear in the `recipes/` folder!

## How It Works

### Development Mode (Current)
- Images saved to: `/srv/madladslab/public/uploads/[folder]/[filename]`
- Accessible at: `http://your-domain/uploads/[folder]/[filename]`
- Good for testing without Linode costs

### Production Mode (After Setup)
- Images uploaded to: Linode Object Storage bucket
- Accessible at: `https://[bucket].us-ord-1.linodeobjects.com/[folder]/[filename]`
- CDN-backed, fast, scalable
- Public access enabled automatically

## Folder Structure

Your images are organized by type:

```
your-bucket/
├── recipes/          # Recipe & menu item photos
├── training/         # Training module materials
├── tasks/            # Task completion photos
├── onboarding/       # Onboarding documents
└── general/          # Other uploads
```

## URLs Generated

### Development (Local)
```
/uploads/recipes/1729371234567-a1b2c3d4.jpg
```

### Production (Linode)
```
https://my-restaurant-media.us-ord-1.linodeobjects.com/recipes/1729371234567-a1b2c3d4.jpg
```

## Security Notes

- ✅ Unique filenames prevent collisions (timestamp + random hash)
- ✅ Files are public-read (required for serving images)
- ✅ 10MB file size limit enforced
- ✅ Only images and PDFs allowed
- ✅ Access keys kept in .env (never committed to git)

## Costs

Linode Object Storage pricing (as of 2024):
- **Storage**: $0.02/GB/month
- **Transfer**: 1TB free/month, then $0.005/GB
- **Example**: 100 recipe photos (~50MB) = ~$0.001/month

Extremely affordable for a restaurant menu system!

## Troubleshooting

### "Linode Object Storage not configured"
- Check that all three env variables are set in `.env`
- Restart your application
- Run `node test-linode-config.js`

### "Access Denied" errors
- Verify your access keys are correct
- Check bucket permissions in Linode dashboard
- Ensure bucket is in Chicago region (us-ord-1)

### Images not loading
- Check browser console for CORS errors
- Verify bucket has public-read ACL enabled
- Check bucket name matches `S3_LOCATION`

## Migration from Local to Linode

Already have local images? They'll continue to work! New uploads will go to Linode once configured.

To migrate existing images:
1. Download images from `/srv/madladslab/public/uploads/`
2. Upload to Linode via web interface or CLI
3. Update database URLs (if needed)

## Questions?

- Test configuration: `node test-linode-config.js`
- View logs: Check your application logs for `[Linode Upload]` messages
- Linode docs: https://www.linode.com/docs/products/storage/object-storage/

---

**Ready to go live?** Just add your three environment variables and restart! 🚀
