import { MongoClient, ObjectId } from "mongodb";
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
const serviceCollection = db.collection("services");

app.get("/services", async (req, res) => {
  const result = await serviceCollection.find({}).toArray();
  res.json(result);
});

app.get("/services/:id", async (req, res) => {
  const serviceId = req.params.id;
  const result = await serviceCollection.findOne({
    _id: new ObjectId(serviceId),
  });
  if (result) {
    res.json(result);
  } else {
    res.status(404).json({ message: "service not found" });
  }
});

app.get("/service-list", async (req, res) => {
  const result = await serviceCollection
    .aggregate([
      {
        $lookup: {
          from: "user",
          let: { vendorIdStr: "$vendorId" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $eq: [{ $toString: "$_id" }, "$$vendorIdStr"],
                },
              },
            },
            {
              $project: {
                _id: 0,
                name: 1,
                image: 1,
              },
            },
          ],
          as: "vendorInfo",
        },
      },
      {
        $unwind: {
          path: "$vendorInfo",
          preserveNullAndEmptyArrays: true, // keeps service even if vendor isn't found
        },
      },
      {
        $project: {
          _id: 1,
          vendorId: 1,
          vendorName: "$vendorInfo.name",
          vendorImage: "$vendorInfo.image",
          name: 1,
          category: 1,
          price: 1,
          location: 1,
          description: 1,
          images: 1,
          status: 1,
          createdAt: 1,
        },
      },
    ])
    .toArray();
  res.json(result);
});

app.post("/services", async (req, res) => {
  const newService = {
    ...req.body,
    status: "pending",
    createdAt: new Date(),
  };
  const result = await serviceCollection.insertOne(newService);
  res.json(result);
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

export default app;
