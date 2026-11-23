import { MongoClient, ObjectId } from "mongodb";
import express from "express";
import cors from "cors";
import jwt from "jsonwebtoken";
import "dotenv/config";

const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || process.env.ACCESS_TOKEN_SECRET || "wedplan_secret_jwt_key_2026";

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
const userCollection = db.collection("user");
const bookingCollection = db.collection("bookings");
const transactionCollection = db.collection("transactions");

export const verifyToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ message: "unauthorized access" });
  }
  const token = authHeader.split(" ")[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    if (decoded.id || decoded.email) {
      let query = {};
      if (decoded.id && ObjectId.isValid(decoded.id)) {
        query = { _id: new ObjectId(decoded.id) };
      } else if (decoded.email) {
        query = { email: decoded.email };
      }
      const existingUser = await userCollection.findOne(query);
      if (existingUser?.isBlocked) {
        return res.status(403).json({ message: "forbidden: account is blocked" });
      }
      if (existingUser?.role) {
        req.user.role = existingUser.role.toLowerCase();
      }
    }
    next();
  } catch (err) {
    return res.status(401).json({ message: "unauthorized access" });
  }
};

export const verifyAdmin = (req, res, next) => {
  const role = req.user?.role?.toLowerCase();
  if (role !== "admin") {
    return res.status(403).json({ message: "forbidden access" });
  }
  next();
};

export const verifyVendor = (req, res, next) => {
  const role = req.user?.role?.toLowerCase();
  if (role !== "vendor" && role !== "admin") {
    return res.status(403).json({ message: "forbidden access" });
  }
  next();
};

export const verifyCustomer = (req, res, next) => {
  const role = req.user?.role?.toLowerCase();
  if (role !== "customer" && role !== "admin") {
    return res.status(403).json({ message: "forbidden access" });
  }
  next();
};

app.post("/jwt", async (req, res) => {
  const { email, role, id } = req.body;
  if (!email) {
    return res.status(400).json({ message: "email is required" });
  }
  let userRole = role || "customer";
  let userId = id;
  const existingUser = await userCollection.findOne({ email });
  if (existingUser) {
    if (existingUser.isBlocked) {
      return res.status(403).json({ message: "account is blocked" });
    }
    if (existingUser.role) {
      userRole = existingUser.role;
    }
    userId = existingUser._id.toString();
  }
  const token = jwt.sign(
    { email, role: userRole.toLowerCase(), id: userId },
    JWT_SECRET,
    { expiresIn: "7d" }
  );
  res.json({ token });
});

app.get("/services", async (req, res) => {
  const result = await serviceCollection.find({}).toArray();
  res.json(result);
});

app.get("/services/:id", async (req, res) => {
  const serviceId = req.params.id;
  if (!ObjectId.isValid(serviceId)) {
    return res.status(400).json({ message: "invalid service id format" });
  }
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
        $match: {
          status: { $regex: /^active$/i },
        },
      },
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
          preserveNullAndEmptyArrays: true,
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
