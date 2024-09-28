import express from 'express';
import cors from 'cors';
import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import session from 'express-session'; // Import express-session
import pkg from 'pg'; // Import the whole 'pg' package as 'pkg'
import { fileURLToPath } from 'url';

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

// Create /uploads directory if it doesn't exist
const uploadDirectory = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDirectory)) {
  fs.mkdirSync(uploadDirectory);
}

// Set up multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDirectory);
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  },
});
const upload = multer({ storage });

// Serve static files from the uploads directory
app.use('/uploads', express.static(uploadDirectory));

// Configure CORS to allow requests from the frontend with credentials
const allowedOrigins = ['https://basilogast.github.io', 'http://localhost:5173'];

app.use(cors({
  origin: function (origin, callback) {
    if (allowedOrigins.includes(origin) || !origin) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true, // If you are using cookies or sessions
}));

// Set up session middleware
app.use(
  session({
    secret: 'your-secret-key', // Replace with your own secret key
    resave: false,
    saveUninitialized: false, // Only save session if modified
    cookie: {
      secure: false, // Set secure: true if using HTTPS
      httpOnly: true, // Prevent JavaScript access to the cookie
      maxAge: 24 * 60 * 60 * 1000, // Session valid for 1 day
    },
  })
);

// Middleware to parse JSON bodies
app.use(express.json());

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
    const baseUrl = `${req.protocol}://${req.get('host')}`;

    const workcards = result.rows.map(workcard => {
      if (workcard.img) {
        workcard.img = `${baseUrl}${workcard.img}`;
      }
      if (workcard.pdfUrl) {
        workcard.pdfUrl = `${baseUrl}${workcard.pdfUrl}`;
      }
      return workcard;
    });

    res.json(workcards);
  } catch (error) {
    console.error(error);
    res.status(500).send('Server Error');
  }
});

// Add a new workcard (with image and PDF uploads)
app.post('/api/workcards', async (req, res) => {
  try {
    const { size, text, textPara, img, pdfUrl, detailsRoute } = req.body;

    const textParaArray = textPara.split(',').map(item => item.trim());
    const result = await pool.query(
      'INSERT INTO workcards (size, img, text, "pdfUrl", "textPara", detailsRoute) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [size, img, text, pdfUrl, textParaArray, detailsRoute]
    );

    const insertedWorkCard = result.rows[0];
    res.status(201).json(insertedWorkCard);
  } catch (error) {
    console.error("Error adding workcard:", error); // Log the actual error
    res.status(500).json({ message: "Server error occurred." });
  }
});


// Delete a workcard by ID
app.delete('/api/workcards/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query('DELETE FROM workcards WHERE id = $1', [id]);
    res.status(200).send('Workcard deleted successfully');
  } catch (error) {
    console.error(error);
    res.status(500).send('Server Error');
  }
});

// Update a workcard by ID (with image and PDF uploads)
app.put('/api/workcards/:id', async (req, res) => {
  const { id } = req.params;
  const { size, text, textPara, img, pdfUrl, detailsRoute } = req.body;

  try {
    const textParaArray = textPara.split(',').map(item => item.trim());
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
    const updatedWorkCard = result.rows[0];
    res.status(200).json(updatedWorkCard);
  } catch (error) {
    console.error(error);
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
