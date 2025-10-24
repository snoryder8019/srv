import { connectDB, getDb } from '../plugins/mongo/mongo.js';
import { ObjectId } from 'mongodb';

async function getUserInfo() {
  await connectDB();
  const db = getDb();

  const userId = '68ef0dbd940d5989b855644f';

  // Try as ObjectId first
  let user = await db.collection('users').findOne({ _id: new ObjectId(userId) });

  if (!user) {
    // Try as string
    user = await db.collection('users').findOne({ _id: userId });
  }

  if (user) {
    console.log('\n✅ User found:');
    console.log(`Username: ${user.username}`);
    console.log(`Email: ${user.email}`);
    console.log(`Role: ${user.userRole || 'N/A'}`);
    console.log(`\nFull object:`);
    console.log(JSON.stringify(user, null, 2));
  } else {
    console.log('❌ User not found with ID:', userId);

    // List all users
    const allUsers = await db.collection('users').find({}).project({ username: 1, email: 1 }).toArray();
    console.log('\n📋 All users in database:');
    allUsers.forEach(u => {
      console.log(`- ${u.username} (${u._id})`);
    });
  }
  process.exit(0);
}

getUserInfo();
