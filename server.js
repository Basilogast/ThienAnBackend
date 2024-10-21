import express from "express";
import cors from "cors";
import nodemailer from "nodemailer";
import dotenv from "dotenv";
import path from "path";
import session from "express-session";
import pkg from "pg"; // PostgreSQL package
import formidableMiddleware from "express-formidable"; // Formidable middleware for handling form data
import { fileURLToPath } from "url";
import admin from "firebase-admin"; // Firebase Admin SDK for file deletion
import { readFile } from "fs/promises"; // Use readFile for async reading of JSON

dotenv.config(); // Load environment variables from .env file

const app = express();
const port = 5000;
const { Pool } = pkg; // Destructure 'Pool' from 'pg'

// PostgreSQL client setup
const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
});

// Get __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Firebase Admin SDK initialization
admin.initializeApp({
  credential: admin.credential.cert({
    type: process.env.FIREBASE_TYPE,
    project_id: process.env.FIREBASE_PROJECT_ID,
    private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
    private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"), // ensure newlines are correctly parsed
    client_email: process.env.FIREBASE_CLIENT_EMAIL,
    client_id: process.env.FIREBASE_CLIENT_ID,
    auth_uri: process.env.FIREBASE_AUTH_URI,
    token_uri: process.env.FIREBASE_TOKEN_URI,
    auth_provider_x509_cert_url:
      process.env.FIREBASE_AUTH_PROVIDER_X509_CERT_URL,
    client_x509_cert_url: process.env.FIREBASE_CLIENT_X509_CERT_URL,
  }),
  storageBucket: "thienanport.appspot.com", // Your Firebase Storage bucket
});

const bucket = admin.storage().bucket(); // Get a reference to the storage bucket

// Middleware setup
app.use(express.json()); // Parse JSON bodies

// Configure CORS to allow requests from the frontend with credentials
const allowedOrigins = [
  "https://basilogast.github.io",
  "http://localhost:5173",
  "https://annguyen.vercel.app",
  "https://demoportfolio1.vercel.app",
];
app.use(
  cors({
    origin: (origin, callback) => {
      if (allowedOrigins.includes(origin) || !origin) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true, // Using cookies or sessions
  })
);

// Set up session middleware
app.use(
  session({
    secret: "your-secret-key", // Replace with your own secret key
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: false, // Set secure: true if using HTTPS
      httpOnly: true, // Prevent JavaScript access to the cookie
      maxAge: 24 * 60 * 60 * 1000, // Session valid for 1 day
    },
  })
);

// --------------- WORKCARDS AND PITCHES ROUTES (POSTGRES) ---------------- //

// Create tables if they don't exist
const createTables = async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS workcards (
      id SERIAL PRIMARY KEY,
      size VARCHAR(50),
      img TEXT,
      text TEXT,
      pdfUrl TEXT,
      textPara TEXT[],
      detailsRoute VARCHAR(255)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS pitches (
      id SERIAL PRIMARY KEY,
      size VARCHAR(50),
      img TEXT,
      text TEXT,
      pdfUrl TEXT,
      textPara TEXT[],
      detailsRoute VARCHAR(255)
    );
  `);
};
createTables();

// Helper function to validate allowed tables
const allowedTables = ["workcards", "pitches", "competition"];
const validateTable = (table) => allowedTables.includes(table);

// Get all records from a specified table
app.get("/api/:table", async (req, res) => {
  const { table } = req.params;

  if (!validateTable(table)) {
    return res.status(400).json({ message: "Invalid table specified" });
  }

  try {
    const result = await pool.query(`SELECT * FROM ${table}`);
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).send("Server Error");
  }
});

// Add a new record to a specified table
app.post("/api/:table", formidableMiddleware(), async (req, res) => {
  const { table } = req.params;

  if (!validateTable(table)) {
    return res.status(400).json({ message: "Invalid table specified" });
  }

  try {
    const { size, text, textPara, img, pdfUrl, detailsRoute } = req.fields;
    console.log(textPara);
    const textParaArray = Array.isArray(JSON.parse(textPara)) ? JSON.parse(textPara) : []; 
    console.log(textParaArray);
    const result = await pool.query(
      `INSERT INTO ${table} (size, img, text, "pdfUrl", "textPara", "detailsRoute") 
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [size, img, text, pdfUrl, textParaArray, detailsRoute]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error(`Error adding to ${table}:`, error);
    res.status(500).json({ message: "Server error occurred." });
  }
});

// Delete a record by ID
// Delete a record by ID
app.delete("/api/:table/:id", async (req, res) => {
  const { table, id } = req.params;

  if (!validateTable(table)) {
    return res.status(400).json({ message: "Invalid table specified" });
  }

  try {
    // Ensure id is a valid integer
    const parsedId = parseInt(id, 10);
    if (isNaN(parsedId)) {
      return res.status(400).json({ message: "Invalid ID format" });
    }

    const result = await pool.query(
      `SELECT img, "pdfUrl" FROM ${table} WHERE id = $1`,
      [parsedId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: `${table} not found` });
    }

    const { img, pdfUrl } = result.rows[0];

    const extractFirebaseFilePath = (url) => {
      const match = decodeURIComponent(url).match(/\/o\/(.*?)\?/);
      return match ? match[1] : null;
    };

    if (img) {
      const imgFilePath = extractFirebaseFilePath(img);
      if (imgFilePath) await bucket.file(imgFilePath).delete();
    }

    if (pdfUrl) {
      const pdfFilePath = extractFirebaseFilePath(pdfUrl);
      if (pdfFilePath) await bucket.file(pdfFilePath).delete();
    }

    await pool.query(`DELETE FROM ${table} WHERE id = $1`, [parsedId]);
    res
      .status(200)
      .json({ message: `${table} and associated files deleted successfully` });
  } catch (error) {
    console.error(`Error deleting from ${table}:`, error);
    res.status(500).send("Server Error");
  }
});

// Update a record by ID
app.put("/api/:table/:id", formidableMiddleware(), async (req, res) => {
  const { table, id } = req.params;

  if (!validateTable(table)) {
    return res.status(400).json({ message: "Invalid table specified" });
  }

  try {
    const { size, text, textPara, detailsRoute, img, pdfUrl } = req.fields;
    console.log(textPara, typeof(textPara));
    const textParaArray = Array.isArray(JSON.parse(textPara)) ? JSON.parse(textPara) : []; 
    console.log(textParaArray, typeof(textParaArray));
    const updates = [];
    const values = [];
    let query = `UPDATE ${table} SET `;

    if (size) {
      updates.push(`size = $${values.length + 1}`);
      values.push(size);
    }
    if (text) {
      updates.push(`text = $${values.length + 1}`);
      values.push(text);
    }
    if (textParaArray.length > 0) {
      updates.push(`"textPara" = $${values.length + 1}`);
      values.push(textParaArray);
    }
    if (detailsRoute) {
      updates.push(`detailsRoute = $${values.length + 1}`);
      values.push(detailsRoute);
    }
    if (img) {
      updates.push(`img = $${values.length + 1}`);
      values.push(img);
    }
    if (pdfUrl) {
      updates.push(`"pdfUrl" = $${values.length + 1}`);
      values.push(pdfUrl);
    }

    if (updates.length === 0) {
      return res.status(400).send("No updates provided.");
    }

    query +=
      updates.join(", ") + ` WHERE id = $${values.length + 1} RETURNING *`;
    values.push(id);

    const result = await pool.query(query, values);
    res.status(200).json(result.rows[0]);
  } catch (error) {
    console.error(`Error updating in ${table}:`, error);
    res.status(500).send("Server Error");
  }
});
// Get a specific record by ID from a specified table
app.get("/api/:table/:id", async (req, res) => {
  const { table, id } = req.params;

  // List of allowed tables to prevent SQL injection
  if (!validateTable(table)) {
    return res.status(400).json({ message: "Invalid table specified" });
  }

  // Parse the id to ensure it's a valid integer
  const parsedId = parseInt(id, 10);
  if (isNaN(parsedId)) {
    return res.status(400).json({ message: "Invalid ID format" });
  }

  try {
    const result = await pool.query(`SELECT * FROM ${table} WHERE id = $1`, [
      parsedId,
    ]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Record not found" });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error(`Error fetching from ${table}:`, error);
    res.status(500).send("Server Error");
  }
});

// Logout Route: Destroy session
app.post("/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ message: "Logout failed" });
    }
    res.clearCookie("connect.sid"); // Clear session cookie
    return res.status(200).json({ message: "Logout successful" });
  });
});
// -------------------- EMAIL ROUTES (NODEMAILER) -------------------- //

// Nodemailer setup for sending emails
const contactEmail = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER, // Use environment variable for email user
    pass: process.env.EMAIL_PASS, // Use environment variable for email password
  },
});

// Verify the email transport connection
contactEmail.verify((error) => {
  if (error) {
    console.log("Error setting up the email service:", error);
  } else {
    console.log("Email service ready to send messages");
  }
});

// Route to handle form submissions
app.post("/contact", (req, res) => {
  const { firstName, lastName, email, message, phone } = req.body;
  const fullName = `${firstName} ${lastName}`;

  const mailOptions = {
    from: fullName,
    to: process.env.EMAIL_USER,
    subject: "Contact Form Submission - Portfolio",
    html: `
      <h3>Contact Form Details</h3>
      <p><strong>Name:</strong> ${fullName}</p>
      <p><strong>Email:</strong> ${email}</p>
      <p><strong>Phone:</strong> ${phone}</p>
      <p><strong>Message:</strong> ${message}</p>
    `,
  };

  contactEmail.sendMail(mailOptions, (error, info) => {
    if (error) {
      res.status(500).json({
        success: false,
        message: "Failed to send message. Please try again later.",
      });
    } else {
      res
        .status(200)
        .json({ success: true, message: "Message sent successfully!" });
    }
  });
});

// Start the server
app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
