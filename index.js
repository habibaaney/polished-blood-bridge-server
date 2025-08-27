const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const dotenv = require("dotenv");
dotenv.config();

const admin = require("firebase-admin");
const serviceAccount = require("./firebaseServiceAccountKey.json");

const app = express();
const PORT = process.env.PORT || 5000;

const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

// Middleware
app.use(cors());
app.use(express.json());

// Firebase Admin Initialization
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

// MongoDB connection
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.6dxtinj.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
   
    // console.log("✅ Connected to MongoDB");

    const db = client.db("bloodBridge");
    const usersCollection = db.collection("users");
    const donationRequestsCollection = db.collection("donationRequests");
    const blogsCollection = db.collection("blogs");
    const fundingsCollection = db.collection("fundings");

    // // Middleware to verify Firebase Token
    
    const verifyFirebaseToken = async (req, res, next) => {
      const authHeader = req.headers?.authorization;
      // console.log("🔒 Auth Header:", authHeader);

      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res
          .status(401)
          .json({ message: "Unauthorized: No token provided" });
      }

      const idToken = authHeader.split(" ")[1];

      try {
        const decodedToken = await admin.auth().verifyIdToken(idToken);
        // console.log("✅ Decoded Firebase Token:", decodedToken);
        req.firebaseUser = decodedToken; 
        next();
      } catch (error) {
        return res
          .status(401)
          .json({ message: "Unauthorized: Invalid token from catch" });
      }
    };

    // ✅ Admin Verification Middleware
    
    const verifyAdmin = (usersCollection) => {
      return async (req, res, next) => {
        const email = req.firebaseUser?.email;
        // console.log("🔍 Verifying admin for email:", email);
        if (!email)
          return res.status(403).json({ message: "No email found in token" });

        try {
          const user = await usersCollection.findOne({ email });
          if (user?.role !== "admin") {
            return res
              .status(403)
              .json({ message: "Access denied: Admins only" });
          }
          next();
        } catch (error) {
          console.error("Admin check error:", error);
          res.status(500).json({ message: "Internal server error" });
        }
      };
    };

    // -----------------------------
    // 🚑 Health Check Routes
    // -----------------------------
    app.get("/", (req, res) => {
      res.json({
        success: true,
        message: "🚑 Blood Bridge Server is running!",
      });
    });

    app.get("/health", (req, res) => {
      res.json({
        status: "healthy",
        database: client.topology?.isConnected() ? "connected" : "disconnected",
      });
    });

    // -------------------------
    // 🧑‍💼 USER ROUTES
    // -------------------------
    app.post("/users", async (req, res) => {
      try {
        const userData = req.body;
        if (!userData.uid || !userData.email) {
          return res
            .status(400)
            .json({ success: false, message: "UID and email are required" });
        }

        const existingUser = await usersCollection.findOne({
          email: userData.email,
        });
        if (existingUser) {
          return res
            .status(409)
            .json({ success: false, message: "User already exists" });
        }

        const newUser = {
          uid: userData.uid,
          email: userData.email,
          name: userData.name || "",
          avatar: userData.avatar || "https://i.ibb.co/4pDNDk1/avatar.png",
          bloodGroup: userData.bloodGroup || "",
          district: userData.district || "",
          upazila: userData.upazila || "",
          role: "donor",
          status: "active",
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        const result = await usersCollection.insertOne(newUser);
        res.status(201).json({
          success: true,
          message: "User created",
          user: { ...newUser, _id: result.insertedId },
        });
      } catch (error) {
        console.error("User creation error:", error);
        res
          .status(500)
          .json({ success: false, message: "Internal server error" });
      }
    });

    app.get("/users", verifyFirebaseToken, async (req, res) => {
      try {
        const users = await usersCollection.find().toArray();
        res.json({ success: true, data: users });
      } catch (error) {
        console.error("Error fetching users:", error);
        res
          .status(500)
          .json({ success: false, message: "Internal server error" });
      }
    });

    // app.get("/users/role/:email", verifyFirebaseToken, async (req, res) => {
    //   try {
    //     const email = req.params.email.toLowerCase();
    //     const user = await usersCollection.findOne({ email });

    //     if (!user) {
    //       return res
    //         .status(404)
    //         .json({ message: "User not found", role: null });
    //     }

    //     res.json({ role: user.role || "user" });
    //   } catch (error) {
    //     console.error("Error getting user role:", error.message);
    //     res.status(500).json({ message: "Server error", role: null });
    //   }
    // });
    // This version causes the 404 error
    // app.get("/users/role/:email", async (req, res) => {
    //   const email = req.params.email.toLowerCase();
    //   const user = await usersCollection.findOne({ email });

    //   if (!user) {
    //     // This is the problem line
    //     return res.status(404).json({ message: "User not found", role: null });
    //   }

    //   res.json({ role: user.role || "user" });
    // });

    // ✅ This is the correct implementation
    app.get("/users/role/:email", async (req, res) => {
      try {
        const email = req.params.email.toLowerCase();
        const user = await usersCollection.findOne({ email });

        // Always return a 200 OK status.
        // If the user doesn't exist, the role is simply null.
        res.json({
          success: true,
          role: user?.role || null,
        });
      } catch (error) {
        console.error("Error getting user role:", error);
        res.status(500).json({
          success: false,
          message: "Server error",
        });
      }
    });
    app.get("/users/:email", async (req, res) => {
      const email = req.params.email;
      try {
        const user = await usersCollection.findOne({ email });
        if (!user) {
          return res.status(404).json({ message: "User not found" });
        }
        res.json(user);
      } catch (err) {
        res.status(500).json({ message: "Server error", error: err });
      }
    });

    app.get("/users/email/:email", async (req, res) => {
      const email = req.params.email;
      try {
        const user = await usersCollection.findOne({ email });
        if (!user) return res.status(404).json({ message: "User not found" });
        res.send(user);
      } catch (error) {
        res.status(500).json({ message: "Server error" });
      }
    });

    app.get("/users/profile/:email", async (req, res) => {
      const email = req.params.email;
      try {
        const user = await usersCollection.findOne({ email });
        if (!user) return res.status(404).json({ message: "User not found" });
        res.send(user);
      } catch (error) {
        console.error("Error fetching profile:", error);
        res.status(500).json({ message: "Internal server error" });
      }
    });

    app.patch(
      "/users/profile/:email",
      verifyFirebaseToken,
      async (req, res) => {
        const email = req.params.email;
        const updates = req.body;
        try {
          const result = await usersCollection.updateOne(
            { email },
            { $set: { ...updates, updatedAt: new Date() } }
          );
          if (result.matchedCount === 0)
            return res.status(404).send({ message: "User not found" });
          res.send({ success: true, message: "Profile updated" });
        } catch (error) {
          console.error("Update error:", error);
          res.status(500).send({ message: "Internal error" });
        }
      }
    );

    // -------------------------
    // 🩸 ADMIN USER MANAGEMENT ROUTES
    // -------------------------

    app.patch("/users/:id", async (req, res) => {
      const id = req.params.id;
      const updates = req.body;
      const result = await usersCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: updates }
      );
      res.send(result);
    });

    // Status update endpoint
    app.patch("/users/status/:id", async (req, res) => {
      const id = req.params.id;
      const { status } = req.body;
      const filter = { _id: new ObjectId(id) };
      const updateDoc = {
        $set: { status },
      };
      const result = await usersCollection.updateOne(filter, updateDoc);
      if (result.modifiedCount > 0) {
        res.send({ success: true });
      } else {
        res.send({ success: false });
      }
    });

    // Role update endpoint
    app.patch("/users/role/:id", async (req, res) => {
      const id = req.params.id;
      const { role } = req.body;
      const filter = { _id: new ObjectId(id) };
      const updateDoc = {
        $set: { role },
      };
      const result = await usersCollection.updateOne(filter, updateDoc);
      if (result.modifiedCount > 0) {
        res.send({ success: true });
      } else {
        res.send({ success: false });
      }
    });

    // -------------------------
    // 🩸 DONATION REQUEST ROUTES
    // -------------------------
    app.post("/donation-requests", async (req, res) => {
      const request = req.body;
      request.status = "pending";
      request.createdAt = new Date();
      try {
        const result = await donationRequestsCollection.insertOne(request);
        res.send(result);
      } catch (err) {
        console.error("Create donation request error:", err);
        res
          .status(500)
          .json({ message: "Failed to create request", error: err });
      }
    });

    app.get("/donation-requests", verifyFirebaseToken, async (req, res) => {
      try {
        const email = req.query.email;
        let query = {};
        if (email) query = { requesterEmail: email };
        const requests = await donationRequestsCollection
          .find(query)
          .sort({ createdAt: -1 })
          .toArray();
        res.send(requests);
      } catch (err) {
        console.error("Fetch donation requests error:", err);
        res.status(500).json({ message: "Failed to fetch requests" });
      }
    });

    app.get("/donation-requests/user/:email", async (req, res) => {
      const email = req.params.email;
      try {
        const userRequests = await donationRequestsCollection
          .find({ requesterEmail: email })
          .sort({ createdAt: -1 })
          .toArray();
        res.send(userRequests);
      } catch (err) {
        console.error("Error fetching user requests:", err);
        res.status(500).json({ message: "Error fetching user requests" });
      }
    });

    app.patch("/donation-requests/:id", async (req, res) => {
      const id = req.params.id;
      const { status } = req.body;
      if (!ObjectId.isValid(id)) {
        return res.status(400).json({ message: "Invalid donation request ID" });
      }
      try {
        const result = await donationRequestsCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { status } }
        );
        if (result.matchedCount === 0) {
          return res
            .status(404)
            .json({ message: "Donation request not found" });
        }
        res.send(result);
      } catch (err) {
        console.error("PATCH donation request status error:", err);
        res.status(500).json({ message: "Failed to update status" });
      }
    });

    app.put("/donation-requests/:id", async (req, res) => {
      const id = req.params.id;
      const updatedData = req.body;
      if (!ObjectId.isValid(id)) {
        return res.status(400).json({ message: "Invalid donation request ID" });
      }
      try {
        const result = await donationRequestsCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: updatedData }
        );
        if (result.matchedCount === 0) {
          return res
            .status(404)
            .json({ message: "Donation request not found" });
        }
        res.send(result);
      } catch (err) {
        console.error("PUT donation request error:", err);
        res.status(500).json({ message: "Failed to update donation request" });
      }
    });

    app.get("/donation-requests/:id", async (req, res) => {
      try {
        const id = req.params.id;
        if (!ObjectId.isValid(id)) {
          return res
            .status(400)
            .json({ message: "Invalid donation request ID" });
        }
        const request = await donationRequestsCollection.findOne({
          _id: new ObjectId(id),
        });
        if (!request) {
          return res
            .status(404)
            .json({ message: "Donation request not found" });
        }
        res.json(request);
      } catch (err) {
        console.error("Error in GET /donation-requests/:id:", err);
        res.status(500).json({ message: "Internal Server Error" });
      }
    });

    app.delete("/donation-requests/:id", async (req, res) => {
      const id = req.params.id;
      try {
        const result = await donationRequestsCollection.deleteOne({
          _id: new ObjectId(id),
        });
        if (result.deletedCount === 0) {
          return res.status(404).send({ error: "Donation request not found" });
        }
        res.send({ message: "Donation request deleted", result });
      } catch (error) {
        console.error("DELETE error:", error);
        res.status(500).send({ error: "Internal Server Error" });
      }
    });

    // PATCH - Update Donation Request Status
    app.patch(
      "/donation-requests/status/:id",
      verifyFirebaseToken,
      async (req, res) => {
        try {
          const id = req.params.id;
          const { status } = req.body;

          if (!status) {
            return res.status(400).json({ error: "Status is required." });
          }

          const result = await donationRequestsCollection.updateOne(
            { _id: new ObjectId(id) },
            { $set: { status } }
          );

          if (result.modifiedCount === 0) {
            return res
              .status(404)
              .json({ error: "Request not found or already updated." });
          }

          res.json({ success: true, message: "Status updated successfully." });
        } catch (error) {
          res.status(500).json({ error: error.message });
        }
      }
    );

    // -----------------------------
    // 🔐 Admin Dashboard Stats (Protected)
    // -----------------------------
    app.get(
      "/admin-stats",
      verifyFirebaseToken,
      verifyAdmin(usersCollection),
      async (req, res) => {
        try {
          const totalUsers = await usersCollection.countDocuments();
          const totalRequests =
            await donationRequestsCollection.countDocuments();

          // Calculate total funding
          const fundingPipeline = [
            { $group: { _id: null, totalFunding: { $sum: "$amount" } } },
          ];
          const fundingResult = await fundingsCollection
            .aggregate(fundingPipeline)
            .toArray();
          const totalFunding = fundingResult[0]?.totalFunding || 0;

          res.send({
            totalUsers,
            totalRequests,
             totalFunding,
          });
        } catch (err) {
          console.error("Admin stats error:", err);
          res.status(500).json({ message: "Failed to load admin stats" });
        }
      }
    );

    // ---------------------------------
    // CONTENT (BLOG) MANAGEMENT ROUTES
    // ---------------------------------

    // POST a new blog post
    app.post(
      "/blogs",
      verifyFirebaseToken,
      verifyAdmin(usersCollection),
      async (req, res) => {
        const blogData = req.body;
        const newBlog = {
          ...blogData,
          status: "draft", 
          createdAt: new Date(),
        };
        const result = await blogsCollection.insertOne(newBlog);
        res.status(201).send(result);
      }
    );

    // GET all blogs (can be filtered by status)
    app.get("/blogs", async (req, res) => {
      const { status } = req.query;
      let query = {};
      if (status && ["draft", "published"].includes(status)) {
        query.status = status;
      }
      const blogs = await blogsCollection
        .find(query)
        .sort({ createdAt: -1 })
        .toArray();
      res.send(blogs);
    });

    // PATCH to update a blog's status (publish/unpublish)
    app.patch(
      "/blogs/status/:id",
      verifyFirebaseToken,
      verifyAdmin(usersCollection),
      async (req, res) => {
        const { id } = req.params;
        const { status } = req.body;
        if (!["draft", "published"].includes(status)) {
          return res.status(400).send({ message: "Invalid status provided" });
        }
        const result = await blogsCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { status } }
        );
        res.send(result);
      }
    );
    // GET a single blog post by its ID
    app.get("/blogs/:id", async (req, res) => {
      const { id } = req.params;
      if (!ObjectId.isValid(id)) {
        return res.status(400).send({ message: "Invalid blog ID format" });
      }
      const blog = await blogsCollection.findOne({ _id: new ObjectId(id) });
      if (!blog) {
        return res.status(404).send({ message: "Blog post not found" });
      }
      res.send(blog);
    });
    // DELETE a blog post
    app.delete(
      "/blogs/:id",
      verifyFirebaseToken,
      verifyAdmin(usersCollection),
      async (req, res) => {
        const { id } = req.params;
        const result = await blogsCollection.deleteOne({
          _id: new ObjectId(id),
        });
        res.send(result);
      }
    );

// -----------------------------
    // 🏦 STRIPE ROUTES
   // -----------------------------

   app.post("/create-payment-intent", verifyFirebaseToken, async (req, res) => {
  try {
    const { amount } = req.body;

    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(amount * 100), 
      currency: "usd",
      payment_method_types: ["card"],
    });

    res.send({
      clientSecret: paymentIntent.client_secret,
    });
  } catch (err) {
    console.error("Stripe payment intent error:", err);
    res.status(500).send({ message: "Failed to create payment intent" });
  }
});


app.post("/fundings", verifyFirebaseToken, async (req, res) => {
  try {
    const fundData = {
      name: req.body.name,
      email: req.firebaseUser.email,
      amount: req.body.amount,
      createdAt: new Date(),
    };

    const result = await fundingsCollection.insertOne(fundData);
    res.send({ success: true, result });
  } catch (err) {
    console.error("Saving fund error:", err);
    res.status(500).send({ success: false });
  }
});

app.get("/fundings", verifyFirebaseToken, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const total = await fundingsCollection.countDocuments();
    const funds = await fundingsCollection
      .find()
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .toArray();

    res.send({ total, page, limit, funds });
  } catch (err) {
    console.error("Fetching fundings error:", err);
    res.status(500).send({ success: false });
  }
});

app.get("/fundings/total", verifyFirebaseToken, async (req, res) => {
  try {
    const pipeline = [
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ];
    const result = await fundingsCollection.aggregate(pipeline).toArray();
    const total = result[0]?.total || 0;
    res.send({ total });
  } catch (err) {
    console.error("Fetching total fund error:", err);
    res.status(500).send({ success: false });
  }
});









  } catch (error) {
    console.error("Server startup error:", error);
    process.exit(1);
  }
}

run().catch(console.dir);

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server is running on port ${PORT}`);
});
