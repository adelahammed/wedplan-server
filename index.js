import { MongoClient, ObjectId } from "mongodb";
import express from "express";
import cors from "cors";
import jwt from "jsonwebtoken";
import Stripe from "stripe";
import "dotenv/config";

const PORT = process.env.PORT || 5000;
const JWT_SECRET =
  process.env.JWT_SECRET ||
  process.env.ACCESS_TOKEN_SECRET ||
  "wedplan_secret_jwt_key_2026";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const app = express();
app.use(
  cors({
    origin: true,
    credentials: true,
  })
);
app.use(express.json());
app.use((req, res, next) => {
  if (req.url.length > 1 && req.url.includes("//")) {
    req.url = req.url.replace(/\/{2,}/g, "/");
  }
  next();
});

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
const paymentCollection = db.collection("payments");

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
        return res
          .status(403)
          .json({ message: "forbidden: account is blocked" });
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
    { expiresIn: "7d" },
  );
  res.json({ token });
});

app.get("/services", verifyToken, verifyAdmin, async (req, res) => {
  const result = await serviceCollection.find({}).toArray();
  res.json(result);
});

app.get(
  "/services/vendor/:vendorId",
  verifyToken,
  verifyVendor,
  async (req, res) => {
    const { vendorId } = req.params;
    if (
      req.user.role !== "admin" &&
      req.user.id !== vendorId &&
      req.user.email !== vendorId
    ) {
      return res
        .status(403)
        .json({ message: "forbidden access to other vendor services" });
    }
    const query = {
      $or: [{ vendorId: vendorId }, { vendorEmail: req.user.email }],
    };
    const result = await serviceCollection
      .find(query)
      .sort({ createdAt: -1 })
      .toArray();
    res.json(result);
  },
);

app.get("/services/:id", verifyToken, async (req, res) => {
  const serviceId = req.params.id;
  if (!ObjectId.isValid(serviceId)) {
    return res.status(400).json({ message: "invalid service id format" });
  }
  const result = await serviceCollection.findOne({
    _id: new ObjectId(serviceId),
  });
  if (result) {
    if (result.vendorId) {
      let vendorUser = null;
      if (ObjectId.isValid(result.vendorId)) {
        vendorUser = await userCollection.findOne({
          _id: new ObjectId(result.vendorId),
        });
      } else if (result.vendorEmail) {
        vendorUser = await userCollection.findOne({
          email: result.vendorEmail,
        });
      }
      if (vendorUser) {
        result.vendorName = result.vendorName || vendorUser.name;
        result.vendorImage = result.vendorImage || vendorUser.image;
        result.vendorEmail = result.vendorEmail || vendorUser.email;
      }
    }
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
    return res
      .status(400)
      .json({ message: "all required fields must be provided" });
  }

  let vendorUser = null;
  if (ObjectId.isValid(vendorId)) {
    vendorUser = await userCollection.findOne({ _id: new ObjectId(vendorId) });
  } else {
    vendorUser = await userCollection.findOne({ email: req.user.email });
  }

  const isPremium =
    vendorUser?.subscriptionPlan?.toLowerCase() === "premium" ||
    vendorUser?.premium === true;
  if (!isPremium) {
    const totalCount = await serviceCollection.countDocuments({
      $or: [{ vendorId: vendorId }, { vendorEmail: req.user.email }],
    });
    if (totalCount >= 3) {
      return res.status(403).json({
        message:
          "Free vendors can publish a maximum of 3 services. Please upgrade to Premium.",
        limitReached: true,
      });
    }
  }

  const newService = {
    ...req.body,
    vendorId: vendorId,
    vendorEmail: req.user.email,
    vendorName: vendorUser?.name || req.body.vendorName || "Vendor",
    vendorImage: vendorUser?.image || req.body.vendorImage || "",
    images:
      Array.isArray(images) && images.length > 0
        ? images
        : [images].filter(Boolean),
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

  const isOwner =
    req.user.id === existing.vendorId ||
    req.user.email === existing.vendorEmail;
  const isAdmin = req.user.role === "admin";

  if (!isOwner && !isAdmin) {
    return res
      .status(403)
      .json({ message: "forbidden: cannot modify service of other vendors" });
  }

  const updates = {};
  const allowed = [
    "name",
    "category",
    "price",
    "location",
    "description",
    "images",
    "status",
  ];
  for (const field of allowed) {
    if (req.body[field] !== undefined) {
      updates[field] = req.body[field];
    }
  }

  if (!isAdmin && updates.status) {
    const nextStatus = updates.status.toLowerCase();
    const currentStatus = (existing.status || "").toLowerCase();
    if (currentStatus === "pending" || currentStatus === "rejected") {
      delete updates.status;
    } else if (["active", "paused", "inactive"].includes(nextStatus)) {
      updates.status = nextStatus === "active" ? "active" : "paused";
    } else {
      delete updates.status;
    }
  }

  updates.updatedAt = new Date();

  await serviceCollection.updateOne(
    { _id: new ObjectId(id) },
    { $set: updates },
  );
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

  const isOwner =
    req.user.id === existing.vendorId ||
    req.user.email === existing.vendorEmail;
  const isAdmin = req.user.role === "admin";

  if (!isOwner && !isAdmin) {
    return res
      .status(403)
      .json({ message: "forbidden: cannot delete service of other vendors" });
  }

  await serviceCollection.deleteOne({ _id: new ObjectId(id) });
  res.json({ success: true, message: "service deleted successfully" });
});

app.post("/bookings", verifyToken, async (req, res) => {
  if (req.user.role === "admin") {
    return res
      .status(403)
      .json({ message: "Admins cannot submit customer booking requests" });
  }

  const { serviceId, eventDate, eventLocation, message } = req.body;
  if (!serviceId || !eventDate || !eventLocation) {
    return res
      .status(400)
      .json({ message: "service, event date, and location are required" });
  }

  if (!ObjectId.isValid(serviceId)) {
    return res.status(400).json({ message: "invalid service id format" });
  }

  const service = await serviceCollection.findOne({
    _id: new ObjectId(serviceId),
  });
  if (!service) {
    return res.status(404).json({ message: "service not found" });
  }

  if (service.status?.toLowerCase() !== "active") {
    return res
      .status(400)
      .json({
        message: "Only approved and active services are available for booking",
      });
  }

  if (
    service.vendorId === req.user.id ||
    service.vendorEmail === req.user.email
  ) {
    return res
      .status(400)
      .json({ message: "Vendors cannot book their own services" });
  }

  const existingBooking = await bookingCollection.findOne({
    serviceId: serviceId,
    eventDate: eventDate,
    status: { $in: ["Pending", "Accepted", "pending", "accepted"] },
  });

  if (existingBooking) {
    return res.status(400).json({
      message:
        "An active booking request already exists for this service on the selected date",
    });
  }

  let customerUser = null;
  if (ObjectId.isValid(req.user.id)) {
    customerUser = await userCollection.findOne({
      _id: new ObjectId(req.user.id),
    });
  } else {
    customerUser = await userCollection.findOne({ email: req.user.email });
  }

  const newBooking = {
    serviceId: serviceId,
    serviceName: service.name,
    serviceImage:
      Array.isArray(service.images) && service.images.length > 0
        ? service.images[0]
        : service.image || "",
    category: service.category,
    price: service.price,
    vendorId: service.vendorId,
    vendorName: service.vendorName,
    vendorEmail: service.vendorEmail,
    customerId: req.user.id,
    customerName: customerUser?.name || req.body.customerName || "Customer",
    customerEmail: req.user.email,
    eventDate,
    eventLocation,
    message: message || "",
    status: "pending",
    createdAt: new Date(),
  };

  const result = await bookingCollection.insertOne(newBooking);
  res.status(201).json({ success: true, insertedId: result.insertedId });
});

app.get("/bookings/customer/:customerId", verifyToken, async (req, res) => {
  const { customerId } = req.params;
  const isAuthorized =
    req.user.role === "admin" ||
    req.user.id === customerId ||
    req.user.email === customerId;
  if (!isAuthorized) {
    return res
      .status(403)
      .json({ message: "forbidden access to customer bookings" });
  }

  const query = {
    $or: [{ customerId: customerId }, { customerEmail: req.user.email }],
  };
  const result = await bookingCollection
    .find(query)
    .sort({ createdAt: -1 })
    .toArray();
  res.json(result);
});

app.get(
  "/bookings/vendor/:vendorId",
  verifyToken,
  verifyVendor,
  async (req, res) => {
    const { vendorId } = req.params;
    const isAuthorized =
      req.user.role === "admin" ||
      req.user.id === vendorId ||
      req.user.email === vendorId;
    if (!isAuthorized) {
      return res
        .status(403)
        .json({ message: "forbidden access to vendor bookings" });
    }

    const query = {
      $or: [{ vendorId: vendorId }, { vendorEmail: req.user.email }],
    };
    const result = await bookingCollection
      .find(query)
      .sort({ createdAt: -1 })
      .toArray();
    res.json(result);
  },
);

app.patch("/bookings/:id/cancel", verifyToken, async (req, res) => {
  const { id } = req.params;
  if (!ObjectId.isValid(id)) {
    return res.status(400).json({ message: "invalid booking id format" });
  }

  const booking = await bookingCollection.findOne({ _id: new ObjectId(id) });
  if (!booking) {
    return res.status(404).json({ message: "booking not found" });
  }

  const isOwner =
    booking.customerId === req.user.id ||
    booking.customerEmail === req.user.email;
  if (!isOwner && req.user.role !== "admin") {
    return res
      .status(403)
      .json({
        message:
          "forbidden: customers cannot modify or cancel another customer's bookings",
      });
  }

  if (booking.status?.toLowerCase() !== "pending") {
    return res.status(400).json({
      message:
        "Customers cannot cancel an already accepted, rejected, or cancelled booking",
    });
  }

  await bookingCollection.updateOne(
    { _id: new ObjectId(id) },
    { $set: { status: "cancelled", updatedAt: new Date() } },
  );
  res.json({ success: true, message: "booking cancelled successfully" });
});

app.patch(
  "/bookings/:id/status",
  verifyToken,
  verifyVendor,
  async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;

    if (!status || !["accepted", "rejected"].includes(status.toLowerCase())) {
      return res
        .status(400)
        .json({ message: "status must be either accepted or rejected" });
    }

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ message: "invalid booking id format" });
    }

    const booking = await bookingCollection.findOne({ _id: new ObjectId(id) });
    if (!booking) {
      return res.status(404).json({ message: "booking not found" });
    }

    const isOwner =
      booking.vendorId === req.user.id ||
      booking.vendorEmail === req.user.email;
    if (!isOwner && req.user.role !== "admin") {
      return res
        .status(403)
        .json({
          message:
            "vendors cannot modify booking requests belonging to other vendors",
        });
    }

    if (booking.status?.toLowerCase() !== "pending") {
      return res
        .status(400)
        .json({
          message:
            "once accepted or rejected, a request cannot be processed again",
        });
    }

    await bookingCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: { status: status.toLowerCase(), updatedAt: new Date() } },
    );
    res.json({
      success: true,
      message: `booking request ${status.toLowerCase()} successfully`,
    });
  },
);

app.get("/admin/stats", verifyToken, verifyAdmin, async (req, res) => {
  const totalUsers = await userCollection.countDocuments({});
  const totalVendors = await userCollection.countDocuments({
    role: { $regex: /^vendor$/i },
  });
  const totalCustomers = await userCollection.countDocuments({
    role: { $regex: /^customer$/i },
  });
  const totalServices = await serviceCollection.countDocuments({});
  const pendingServices = await serviceCollection.countDocuments({
    status: { $regex: /^pending$/i },
  });
  const totalTransactions = await transactionCollection.countDocuments({});

  const recentTransactions = await transactionCollection
    .find({})
    .sort({ createdAt: -1 })
    .limit(5)
    .toArray();

  res.json({
    totalUsers,
    totalVendors,
    totalCustomers,
    totalServices,
    pendingServices,
    totalTransactions,
    recentTransactions,
  });
});

app.get("/admin/services", verifyToken, verifyAdmin, async (req, res) => {
  const { search, status } = req.query;
  const query = {};

  if (status && status !== "All") {
    query.status = { $regex: new RegExp(`^${status}$`, "i") };
  }

  if (search) {
    query.$or = [
      { name: { $regex: new RegExp(search, "i") } },
      { category: { $regex: new RegExp(search, "i") } },
      { location: { $regex: new RegExp(search, "i") } },
      { vendorName: { $regex: new RegExp(search, "i") } },
    ];
  }

  const result = await serviceCollection
    .find(query)
    .sort({ createdAt: -1 })
    .toArray();
  res.json(result);
});

app.patch(
  "/services/:id/status",
  verifyToken,
  verifyAdmin,
  async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;

    if (
      !status ||
      !["active", "pending", "rejected", "paused", "inactive"].includes(
        status.toLowerCase(),
      )
    ) {
      return res.status(400).json({ message: "invalid status value" });
    }

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ message: "invalid service id format" });
    }

    await serviceCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: { status: status.toLowerCase(), updatedAt: new Date() } },
    );

    res.json({ success: true, message: `service status updated to ${status}` });
  },
);

app.get("/users", verifyToken, verifyAdmin, async (req, res) => {
  const { search, role } = req.query;
  const query = {};

  if (role && role !== "All") {
    query.role = { $regex: new RegExp(`^${role}$`, "i") };
  }

  if (search) {
    query.$or = [
      { name: { $regex: new RegExp(search, "i") } },
      { email: { $regex: new RegExp(search, "i") } },
    ];
  }

  const result = await userCollection
    .find(query)
    .sort({ createdAt: -1 })
    .toArray();
  res.json(result);
});

app.get("/users/:id", verifyToken, async (req, res) => {
  const { id } = req.params;
  if (!ObjectId.isValid(id)) {
    return res.status(400).json({ message: "invalid user id format" });
  }

  const isSelf = req.user.id === id;
  const isAdmin = req.user.role === "admin";

  if (!isSelf && !isAdmin) {
    return res
      .status(403)
      .json({ message: "forbidden access to user details" });
  }

  const user = await userCollection.findOne({ _id: new ObjectId(id) });
  if (!user) {
    return res.status(404).json({ message: "user not found" });
  }

  const servicesCount = await serviceCollection.countDocuments({
    vendorId: id,
  });
  const bookingsCount = await bookingCollection.countDocuments({
    customerId: id,
  });

  res.json({
    ...user,
    servicesCount,
    bookingsCount,
  });
});

app.patch("/users/:id/block", verifyToken, verifyAdmin, async (req, res) => {
  const { id } = req.params;
  if (!ObjectId.isValid(id)) {
    return res.status(400).json({ message: "invalid user id format" });
  }

  const { isBlocked } = req.body;
  await userCollection.updateOne(
    { _id: new ObjectId(id) },
    { $set: { isBlocked: Boolean(isBlocked), updatedAt: new Date() } },
  );

  res.json({
    success: true,
    message: `user block status updated to ${isBlocked}`,
  });
});

app.delete("/users/:id", verifyToken, verifyAdmin, async (req, res) => {
  const { id } = req.params;
  if (!ObjectId.isValid(id)) {
    return res.status(400).json({ message: "invalid user id format" });
  }

  await userCollection.deleteOne({ _id: new ObjectId(id) });
  res.json({ success: true, message: "user deleted successfully" });
});

app.post("/users/sync-role", async (req, res) => {
  const { email, role } = req.body;
  if (!email || !role) {
    return res.status(400).json({ message: "email and role are required" });
  }
  const normalizedRole = role.toLowerCase();
  if (!["customer", "vendor"].includes(normalizedRole)) {
    return res.status(400).json({ message: "invalid role" });
  }
  const existingUser = await userCollection.findOne({ email });
  if (existingUser && existingUser.role === "admin") {
    return res.json({ success: true, message: "admin role preserved" });
  }
  await userCollection.updateOne(
    { email },
    { $set: { role: normalizedRole, updatedAt: new Date() } },
  );
  res.json({ success: true, message: `role synced to ${normalizedRole}` });
});

app.post("/payments/verify-session", async (req, res) => {
  const { sessionId } = req.body;
  if (!sessionId) {
    return res
      .status(400)
      .json({ success: false, message: "session ID is required" });
  }
  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (!session) {
      return res
        .status(404)
        .json({ success: false, message: "session not found" });
    }
    res.json({
      success: true,
      status: session.status,
      payment_status: session.payment_status,
      amount_total: session.amount_total,
      currency: session.currency,
      customer_email: session.customer_email || session.customer_details?.email,
    });
  } catch (err) {
    res.status(400).json({ success: false, message: "invalid stripe session" });
  }
});

app.post(
  "/payments/cancel-subscription",
  verifyToken,
  verifyVendor,
  async (req, res) => {
    const userId = req.user.id;
    let query = {};
    if (ObjectId.isValid(userId)) {
      query = { _id: new ObjectId(userId) };
    } else if (req.user.email) {
      query = { email: req.user.email };
    } else {
      return res.status(400).json({ message: "invalid user identifier" });
    }

    const user = await userCollection.findOne(query);
    if (!user) {
      return res.status(404).json({ message: "user not found" });
    }

    await userCollection.updateOne(query, {
      $set: {
        premium: false,
        subscriptionPlan: "Free",
        subscriptionExpiresAt: null,
        updatedAt: new Date(),
      },
    });

    await transactionCollection.insertOne({
      vendorId: user._id.toString(),
      customer_email: user.email,
      plan: "Free",
      amount: 0,
      currency: "usd",
      status: "cancelled",
      createdAt: new Date(),
    });

    res.json({
      success: true,
      message: "subscription cancelled and reverted to Free plan",
    });
  },
);

app.post("/payments/webhook", async (req, res) => {
  const sig = req.headers["stripe-signature"];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  let event;

  try {
    if (webhookSecret && sig) {
      event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    } else {
      event = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    }
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event?.type === "checkout.session.completed") {
    const session = event.data.object;
    const userId = session.metadata?.userId;
    const customerEmail =
      session.customer_email || session.customer_details?.email;
    let query = {};
    if (userId && ObjectId.isValid(userId)) {
      query = { _id: new ObjectId(userId) };
    } else if (userId) {
      query = { _id: userId };
    } else if (customerEmail) {
      query = { email: customerEmail };
    }

    if (Object.keys(query).length > 0) {
      await userCollection.updateOne(query, {
        $set: {
          premium: true,
          subscriptionPlan: "Premium",
          subscriptionExpiresAt: null,
          updatedAt: new Date(),
        },
      });

      await transactionCollection.insertOne({
        vendorId: userId || "",
        customer_email: customerEmail || "",
        sessionId: session.id,
        amount: session.amount_total ? session.amount_total / 100 : 150,
        currency: session.currency || "usd",
        plan: session.metadata?.plan || "Platinum Signature",
        status: "completed",
        createdAt: new Date(),
      });
    }
  }

  res.json({ received: true });
});

app.post("/payments/checkout-verify", async (req, res) => {
  try {
    const { sessionId } = req.body;

    if (!sessionId) {
      return res.send({
        success: false,
        message: "Session ID is required",
      });
    }

    const session = await stripe.checkout.sessions.retrieve(sessionId);

    const {
      status,
      payment_status,
      customer_email,
      customer_details,
      metadata,
      payment_intent,
      amount_total,
      currency,
    } = session;

    const userId = metadata?.userId;
    let query = {};
    if (userId && ObjectId.isValid(userId)) {
      query = { _id: new ObjectId(userId) };
    } else if (userId) {
      query = { _id: userId };
    } else if (customer_email || customer_details?.email) {
      query = { email: customer_email || customer_details?.email };
    }

    const targetUser = await userCollection.findOne(query);
    if (
      targetUser &&
      targetUser.role &&
      targetUser.role.toLowerCase() !== "vendor" &&
      targetUser.role.toLowerCase() !== "admin"
    ) {
      return res.status(403).json({
        success: false,
        message: "only vendors can purchase subscriptions",
      });
    }

    if (status === "complete" && payment_status === "paid") {
      const sessionQuery = { sessionId };
      const existingPayment = await paymentCollection.findOne(sessionQuery);

      if (existingPayment) {
        return res.send({
          success: true,
          alreadyVerified: true,
          message: "Payment already verified",
          payment: existingPayment,
          session: {
            id: sessionId,
            status,
            payment_status,
            customer_email: customer_email || customer_details?.email,
            customer_name: customer_details?.name,
            amount_total,
            currency,
            plan: metadata?.plan || "Platinum Signature",
            payment_intent,
          },
        });
      }

      const payment = {
        sessionId,
        status,
        payment_status,
        customer_email: customer_email || customer_details?.email || "",
        userId: metadata?.userId || "",
        payment_date: new Date(),
        payment_intent,
      };

      const result = await paymentCollection.insertOne(payment);

      const updatedDoc = {
        $set: {
          premium: true,
          subscriptionPlan: "Premium",
          subscriptionExpiresAt: null,
          updatedAt: new Date(),
        },
      };

      const updateResult = await userCollection.updateOne(query, updatedDoc);

      await transactionCollection.insertOne({
        vendorId: metadata?.userId || "",
        customer_email: customer_email || customer_details?.email || "",
        sessionId,
        amount: amount_total ? amount_total / 100 : 150,
        currency: currency || "usd",
        plan: metadata?.plan || "Platinum Signature",
        status: "completed",
        createdAt: new Date(),
      });

      return res.send({
        success: true,
        result,
        updateResult,
        session: {
          id: sessionId,
          status,
          payment_status,
          customer_email: customer_email || customer_details?.email,
          customer_name: customer_details?.name,
          amount_total,
          currency,
          plan: metadata?.plan || "Platinum Signature",
          payment_intent,
        },
      });
    }

    res.send({
      success: false,
      message: "Payment verification failed",
    });
  } catch (error) {
    console.error("Payment verification error:", error);

    res.status(500).send({
      success: false,
      message: "Internal server error",
    });
  }
});

app.get("/transactions", verifyToken, async (req, res) => {
  const isAdmin = req.user.role === "admin";
  const query = isAdmin ? {} : { vendorId: req.user.id };
  const result = await transactionCollection
    .find(query)
    .sort({ createdAt: -1 })
    .toArray();
  res.json(result);
});

app.get(
  "/vendor/stats/:vendorId",
  verifyToken,
  verifyVendor,
  async (req, res) => {
    const { vendorId } = req.params;
    if (
      req.user.role !== "admin" &&
      req.user.id !== vendorId &&
      req.user.email !== vendorId
    ) {
      return res.status(403).json({ message: "forbidden access" });
    }

    const totalServices = await serviceCollection.countDocuments({
      $or: [{ vendorId: vendorId }, { vendorEmail: req.user.email }],
    });
    const activeServices = await serviceCollection.countDocuments({
      $or: [{ vendorId: vendorId }, { vendorEmail: req.user.email }],
      status: { $regex: /^active$/i },
    });
    const pendingBookings = await bookingCollection.countDocuments({
      $or: [{ vendorId: vendorId }, { vendorEmail: req.user.email }],
      status: { $regex: /^pending$/i },
    });
    const acceptedBookings = await bookingCollection.countDocuments({
      $or: [{ vendorId: vendorId }, { vendorEmail: req.user.email }],
      status: { $regex: /^accepted$/i },
    });

    const vendorUser = await userCollection.findOne({
      $or: [
        ObjectId.isValid(vendorId) ? { _id: new ObjectId(vendorId) } : null,
        { email: req.user.email },
      ].filter(Boolean),
    });

    res.json({
      totalServices,
      activeServices,
      pendingBookings,
      acceptedBookings,
      subscriptionPlan:
        vendorUser?.subscriptionPlan ||
        (vendorUser?.premium ? "Premium" : "Free"),
    });
  },
);

app.get(
  "/customer/stats/:customerId",
  verifyToken,
  verifyCustomer,
  async (req, res) => {
    const { customerId } = req.params;
    if (
      req.user.role !== "admin" &&
      req.user.id !== customerId &&
      req.user.email !== customerId
    ) {
      return res.status(403).json({ message: "forbidden access" });
    }

    const totalBookings = await bookingCollection.countDocuments({
      $or: [{ customerId: customerId }, { customerEmail: req.user.email }],
    });
    const pendingBookings = await bookingCollection.countDocuments({
      $or: [{ customerId: customerId }, { customerEmail: req.user.email }],
      status: { $regex: /^pending$/i },
    });
    const acceptedBookings = await bookingCollection.countDocuments({
      $or: [{ customerId: customerId }, { customerEmail: req.user.email }],
      status: { $regex: /^accepted$/i },
    });
    const rejectedBookings = await bookingCollection.countDocuments({
      $or: [{ customerId: customerId }, { customerEmail: req.user.email }],
      status: { $regex: /^rejected$/i },
    });

    res.json({
      totalBookings,
      pendingBookings,
      acceptedBookings,
      rejectedBookings,
    });
  },
);

app.patch("/users/profile/:id", verifyToken, async (req, res) => {
  const { id } = req.params;
  if (!ObjectId.isValid(id)) {
    return res.status(400).json({ message: "invalid user id format" });
  }

  const isSelf = req.user.id === id;
  const isAdmin = req.user.role === "admin";

  if (!isSelf && !isAdmin) {
    return res
      .status(403)
      .json({ message: "forbidden: cannot modify profile of other users" });
  }

  const { name, image, businessName, phone, location, bio } = req.body;
  const updates = {};
  if (name !== undefined) updates.name = name;
  if (image !== undefined) updates.image = image;
  if (businessName !== undefined) updates.businessName = businessName;
  if (phone !== undefined) updates.phone = phone;
  if (location !== undefined) updates.location = location;
  if (bio !== undefined) updates.bio = bio;
  updates.updatedAt = new Date();

  await userCollection.updateOne({ _id: new ObjectId(id) }, { $set: updates });
  res.json({ success: true, message: "profile updated successfully" });
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

export default app;
