import mongoose from 'mongoose';

let connectionPromise;

const connectDB = async () => {
  const mongoUri = process.env.MONGO_URI?.trim();
  if (!mongoUri) {
    throw new Error('MONGO_URI_MISSING');
  }

  if (mongoose.connection.readyState === 1) return mongoose.connection;

  if (!connectionPromise) {
    connectionPromise = mongoose.connect(mongoUri, {
      serverSelectionTimeoutMS: 10000,
      bufferCommands: false,
    }).catch((error) => {
      connectionPromise = undefined;
      throw error;
    });
  }

  await connectionPromise;
  console.log('MongoDB connected successfully');
  return mongoose.connection;
};

export default connectDB;
