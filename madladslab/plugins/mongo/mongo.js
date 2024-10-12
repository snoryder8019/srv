import { MongoClient } from'mongodb';

const uri =`mongodb+srv://${process.env.MON_USER}:${process.env.MON_PASS}@${process.env.MON_CLUSTER}/`

const client = new MongoClient(uri);

const connectDB =async()=> {
    try {
        await client.connect();
        console.log('Connected to MongoDB');
        
        const db = client.db('yourDatabaseName'); // Replace with your database name
        return db;
    } catch (err) {
        console.error('MongoDB connection error:', err);
    }
}

export default connectDB
