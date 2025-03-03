// Simple script to test MongoDB connection
const { MongoClient } = require('mongodb');
require('dotenv').config({ path: '.env.local' });

async function testConnection() {
  console.log('Testing MongoDB connection...');
  
  if (!process.env.MONGODB_URI) {
    console.error('MONGODB_URI environment variable is not defined.');
    process.exit(1);
  }
  
  const uri = process.env.MONGODB_URI;
  console.log('Using connection string (masked):', 
    uri.replace(/\/\/([^:]+):([^@]+)@/, '//[USERNAME]:[PASSWORD]@'));
  
  const client = new MongoClient(uri);
  
  try {
    await client.connect();
    console.log('Successfully connected to MongoDB!');
    
    // List databases to verify connection works fully
    const adminDb = client.db('admin');
    const result = await adminDb.command({ listDatabases: 1 });
    
    console.log('Available databases:');
    result.databases.forEach(db => {
      console.log(`- ${db.name}`);
    });
    
  } catch (error) {
    console.error('Failed to connect to MongoDB:', error);
  } finally {
    await client.close();
    console.log('Connection closed');
  }
}

testConnection().catch(console.error); 