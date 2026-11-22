import { MongoClient } from "mongodb";
import express from "express";
import cors from "cors";
import "dotenv/config";

const PORT = process.env.PORT || 5000;

const app = express();
app.use(cors());
app.use(express.json());

const client = new MongoClient(process.env.MONGODB_URL);

export async function connectToMongoDB() {
  try {
    await client.connect();
    console.log("You successfully connected to MongoDB!");
    return client;
  } catch (err) {
    console.dir(err);
  }
}
const connectDB = await connectToMongoDB();

const db = connectDB.db("wedplan");
const testcollection = db.collection("test");

app.get("/test", async (req, res) => {
  const result = await testcollection.find({}).toArray();
  res.json(result);
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

export default app;
