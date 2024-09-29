import express from 'express';
import cors from 'cors';
import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
import path from 'path';
import session from 'express-session';
import pkg from 'pg'; // PostgreSQL package
import formidableMiddleware from 'express-formidable'; // Formidable middleware for handling form data
import { fileURLToPath } from 'url';
import admin from 'firebase-admin'; // Firebase Admin SDK for file deletion
import { readFile } from 'fs/promises'; // Use readFile for async reading of JSON

dotenv.config(); // Load environment variables from .env file

const app = express();
const port = 5000;
const { Pool } = pkg; // Destructure 'Pool' from 'pg'

// PostgreSQL client setup
const pool = new Pool({
  // user: 'workcardsuser',
  // host: 'localhost',
  // database: 'workcardsdb',
  // password: 'Hung08112003',
  // port: 5432,
  user: 'postgres.gqfnhqrxmjtkoeoopfff',
  host: 'aws-0-eu-central-1.pooler.supabase.com',
  database: 'postgres',
  password: 'Shadowmane@08112003',
  port: 6543,
});

// Get __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Use readFile to read the serviceAccountKey.json asynchronously
const serviceAccount = JSON.parse(
  await readFile(new URL('./serviceAccountKey.json', import.meta.url))
);

// Firebase Admin SDK initialization
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  storageBucket: 'thienanport.appspot.com', // Replace with your Firebase Storage bucket
});
const bucket = admin.storage().bucket(); // Get a reference to the storage bucket

// Middleware setup
app.use(formidableMiddleware());
app.use(express.json()); // Parse JSON bodies

// Configure CORS to allow requests from the frontend with credentials
const allowedOrigins = ['https://basilogast.github.io', 'http://localhost:5173'];
app.use(cors({
  origin: (origin, callback) => {
    if (allowedOrigins.includes(origin) || !origin) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true, // Using cookies or sessions
}));

// Set up session middleware
app.use(
  session({
    secret: 'your-secret-key', // Replace with your own secret key
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: false, // Set secure: true if using HTTPS
      httpOnly: true, // Prevent JavaScript access to the cookie
      maxAge: 24 * 60 * 60 * 1000, // Session valid for 1 day
    },
  })
);

// --------------- WORKCARDS ROUTES (POSTGRES) ---------------- //

// Create table if it doesn't exist
const createTable = async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS workcards (
      id SERIAL PRIMARY KEY,
      size VARCHAR(50),
      img TEXT,
      text TEXT,
      pdfUrl TEXT,
      textPara TEXT[],
      detailsRoute VARCHAR(255)
    )
  `);
};
createTable();

// Get all workcards
app.get('/api/workcards', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM workcards');
    res.json(result.rows); // Return the workcards without modifying the img or pdfUrl fields
  } catch (error) {
    console.error(error);
    res.status(500).send('Server Error');
  }
});

// Add a new workcard
app.post('/api/workcards', async (req, res) => {
  try {
    console.log("Request Fields:", req.fields);
    const { size, text, textPara, img, pdfUrl, detailsRoute } = req.fields;

    // Safely handle the textPara array
    const textParaArray = textPara ? textPara.split(',').map(item => item.trim()) : [];

    // Insert into database
    const result = await pool.query(
      'INSERT INTO workcards (size, img, text, "pdfUrl", "textPara", detailsRoute) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [size, img, text, pdfUrl, textParaArray, detailsRoute]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error("Error adding workcard:", error);
    res.status(500).json({ message: "Server error occurred." });
  }
});

// Delete a workcard by ID, and remove associated files from Firebase Storage
// Delete a workcard by ID, and remove associated files from Firebase Storage
// Delete a workcard by ID, and remove associated files from Firebase Storage
app.delete('/api/workcards/:id', async (req, res) => {
  const { id } = req.params;

  console.log('Delete request received for workcard with id:', id);

  try {
    // Retrieve workcard to get img and pdfUrl for deletion
    const result = await pool.query('SELECT img, "pdfUrl" FROM workcards WHERE id = $1', [id]);

    if (result.rows.length === 0) {
      console.log('Workcard not found with id:', id);
      return res.status(404).json({ message: 'Workcard not found' });
    }

    const { img, pdfUrl } = result.rows[0];

    console.log('img:', img, 'pdfUrl:', pdfUrl);

    // Helper function to extract Firebase file path from URL
    const extractFirebaseFilePath = (url) => {
      const match = decodeURIComponent(url).match(/\/o\/(.*?)\?/);
      return match ? match[1] : null;
    };

    // Remove img from Firebase Storage
    if (img) {
      const imgFilePath = extractFirebaseFilePath(img);
      if (imgFilePath) {
        console.log(`Attempting to delete image: ${imgFilePath}`);
        await bucket.file(imgFilePath).delete();
        console.log(`Deleted image: ${imgFilePath}`);
      } else {
        console.log('No valid image file path extracted for deletion.');
      }
    } else {
      console.log('No image found for workcard with id:', id);
    }

    // Remove pdf from Firebase Storage
    if (pdfUrl) {
      const pdfFilePath = extractFirebaseFilePath(pdfUrl);
      if (pdfFilePath) {
        console.log(`Attempting to delete PDF: ${pdfFilePath}`);
        await bucket.file(pdfFilePath).delete();
        console.log(`Deleted PDF: ${pdfFilePath}`);
      } else {
        console.log('No valid PDF file path extracted for deletion.');
      }
    } else {
      console.log('No PDF found for workcard with id:', id);
    }

    // Delete workcard from the database
    await pool.query('DELETE FROM workcards WHERE id = $1', [id]);
    console.log('Deleted workcard from database with id:', id);

    res.status(200).json({ message: 'Workcard and associated files deleted successfully' });
  } catch (error) {
    console.error('Error deleting workcard or files:', error);
    res.status(500).send('Server Error');
  }
});




// Update a workcard by ID
app.put('/api/workcards/:id', async (req, res) => {
  const { id } = req.params;
  const { size, text, textPara, detailsRoute, img, pdfUrl } = req.fields;

  try {
    const textParaArray = textPara ? textPara.split(',').map(item => item.trim()) : [];

    const updates = [];
    const values = [];
    let query = 'UPDATE workcards SET ';

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
      return res.status(400).send('No updates provided.');
    }

    query += updates.join(', ') + ` WHERE id = $${values.length + 1} RETURNING *`;
    values.push(id);

    const result = await pool.query(query, values);
    res.status(200).json(result.rows[0]);
  } catch (error) {
    console.error('Error updating workcard:', error);
    res.status(500).send('Server Error');
  }
});

// Get a specific workcard by ID
app.get('/api/workcards/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query('SELECT * FROM workcards WHERE id = $1', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Workcard not found" });
    }
    res.json(result.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).send('Server Error');
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
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER, // Use environment variable for email user
    pass: process.env.EMAIL_PASS  // Use environment variable for email password
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
    to: process.env.EMAIL_USER, // The email that will receive form submissions
    subject: "Contact Form Submission - Portfolio",
    html: `
      <h3>Contact Form Details</h3>
      <p><strong>Name:</strong> ${fullName}</p>
      <p><strong>Email:</strong> ${email}</p>
      <p><strong>Phone:</strong> ${phone}</p>
      <p><strong>Message:</strong> ${message}</p>
    `,
  };

  // Send the email using the Nodemailer transport
  contactEmail.sendMail(mailOptions, (error, info) => {
    if (error) {
      console.error("Error sending email:", error);
      res.status(500).json({ success: false, message: "Failed to send message. Please try again later." });
    } else {
      console.log("Message sent:", info.response);
      res.status(200).json({ success: true, message: "Message sent successfully!" });
    }
  });
});

// Start the server
app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
