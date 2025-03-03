// Script to set up MongoDB database and collections
const { MongoClient } = require('mongodb');
require('dotenv').config({ path: '.env.local' });

async function setupDatabase() {
  console.log('Setting up MongoDB database...');
  
  if (!process.env.MONGODB_URI) {
    console.error('MONGODB_URI environment variable is not defined.');
    process.exit(1);
  }
  
  const uri = process.env.MONGODB_URI;
  const client = new MongoClient(uri);
  
  try {
    await client.connect();
    console.log('Connected to MongoDB.');
    
    // Extract database name from connection string, or use default
    let dbName = 'college_compass';
    const uriParts = uri.split('/');
    if (uriParts.length > 3) {
      const dbPart = uriParts[3].split('?')[0];
      if (dbPart) dbName = dbPart;
    }
    
    const db = client.db(dbName);
    console.log(`Using database: ${dbName}`);
    
    // Create collections if they don't exist
    await db.createCollection('users');
    await db.createCollection('assessments');
    
    console.log('Collections created/verified.');
    
    // Create indexes for better performance
    await db.collection('users').createIndex({ email: 1 }, { unique: true });
    await db.collection('assessments').createIndex({ user: 1, type: 1, completedAt: -1 });
    
    console.log('Indexes created.');
    
    console.log('Database setup completed successfully!');
  } catch (error) {
    console.error('Error setting up database:', error);
  } finally {
    await client.close();
    console.log('Connection closed.');
  }
}

setupDatabase().catch(console.error); 