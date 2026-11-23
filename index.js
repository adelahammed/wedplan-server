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

app.get("/services/vendor/:vendorId", verifyToken, verifyVendor, async (req, res) => {
  const { vendorId } = req.params;
  if (req.user.role !== "admin" && req.user.id !== vendorId && req.user.email !== vendorId) {
    return res.status(403).json({ message: "forbidden access to other vendor services" });
  }
  const query = {
    $or: [
      { vendorId: vendorId },
      { vendorEmail: req.user.email }
    ]
  };
  const result = await serviceCollection.find(query).sort({ createdAt: -1 }).toArray();
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
  const { search, category, location, sort } = req.query;
  const matchStage = {
    status: { $regex: /^active$/i },
  };

  if (category && category !== "All") {
    matchStage.category = { $regex: new RegExp(`^${category}$`, "i") };
  }

  if (location && location !== "All") {
    matchStage.location = { $regex: new RegExp(location, "i") };
  }

  if (search) {
    matchStage.$or = [
      { name: { $regex: new RegExp(search, "i") } },
      { description: { $regex: new RegExp(search, "i") } },
      { location: { $regex: new RegExp(search, "i") } },
      { category: { $regex: new RegExp(search, "i") } },
    ];
  }

  const pipeline = [
    { $match: matchStage },
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
        vendorName: { $ifNull: ["$vendorInfo.name", "$vendorName"] },
        vendorImage: { $ifNull: ["$vendorInfo.image", "$vendorImage"] },
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
  ];

  if (sort === "price-asc") {
    pipeline.push({ $sort: { price: 1 } });
  } else if (sort === "price-desc") {
    pipeline.push({ $sort: { price: -1 } });
  } else {
    pipeline.push({ $sort: { createdAt: -1 } });
  }

  const result = await serviceCollection.aggregate(pipeline).toArray();
  res.json(result);
});

app.post("/services", verifyToken, verifyVendor, async (req, res) => {
  const vendorId = req.user.id;
  const { name, category, price, location, description, images } = req.body;

  if (!name || !category || !price || !location || !description) {
    return res.status(400).json({ message: "all required fields must be provided" });
  }

  let vendorUser = null;
  if (ObjectId.isValid(vendorId)) {
    vendorUser = await userCollection.findOne({ _id: new ObjectId(vendorId) });
  } else {
    vendorUser = await userCollection.findOne({ email: req.user.email });
  }

  const isPremium = vendorUser?.subscriptionPlan?.toLowerCase() === "premium";
  if (!isPremium) {
    const activeCount = await serviceCollection.countDocuments({
      vendorId: vendorId,
      status: { $regex: /^active$/i },
    });
    if (activeCount >= 3) {
      return res.status(403).json({
        message: "Free vendors can publish a maximum of 3 active services. Please upgrade to Premium.",
      });
    }
  }

  const newService = {
    ...req.body,
    vendorId: vendorId,
    vendorEmail: req.user.email,
    vendorName: vendorUser?.name || req.body.vendorName || "Vendor",
    vendorImage: vendorUser?.image || req.body.vendorImage || "",
    images: Array.isArray(images) && images.length > 0 ? images : [images].filter(Boolean),
    status: "pending",
    createdAt: new Date(),
  };

  const result = await serviceCollection.insertOne(newService);
  res.status(201).json({ success: true, insertedId: result.insertedId });
});

app.patch("/services/:id", verifyToken, async (req, res) => {
  const { id } = req.params;
  if (!ObjectId.isValid(id)) {
    return res.status(400).json({ message: "invalid service id format" });
  }

  const existing = await serviceCollection.findOne({ _id: new ObjectId(id) });
  if (!existing) {
    return res.status(404).json({ message: "service not found" });
  }

  const isOwner = req.user.id === existing.vendorId || req.user.email === existing.vendorEmail;
  const isAdmin = req.user.role === "admin";

  if (!isOwner && !isAdmin) {
    return res.status(403).json({ message: "forbidden: cannot modify service of other vendors" });
  }

  const updates = {};
  const allowed = ["name", "category", "price", "location", "description", "images", "status"];
  for (const field of allowed) {
    if (req.body[field] !== undefined) {
      updates[field] = req.body[field];
    }
  }

  if (!isAdmin && updates.status && !["active", "inactive"].includes(updates.status.toLowerCase())) {
    delete updates.status;
  }

  updates.updatedAt = new Date();

  await serviceCollection.updateOne({ _id: new ObjectId(id) }, { $set: updates });
  res.json({ success: true, message: "service updated successfully" });
});

app.delete("/services/:id", verifyToken, async (req, res) => {
  const { id } = req.params;
  if (!ObjectId.isValid(id)) {
    return res.status(400).json({ message: "invalid service id format" });
  }

  const existing = await serviceCollection.findOne({ _id: new ObjectId(id) });
  if (!existing) {
    return res.status(404).json({ message: "service not found" });
  }

  const isOwner = req.user.id === existing.vendorId || req.user.email === existing.vendorEmail;
  const isAdmin = req.user.role === "admin";

  if (!isOwner && !isAdmin) {
    return res.status(403).json({ message: "forbidden: cannot delete service of other vendors" });
  }

  await serviceCollection.deleteOne({ _id: new ObjectId(id) });
  res.json({ success: true, message: "service deleted successfully" });
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

export default app;
