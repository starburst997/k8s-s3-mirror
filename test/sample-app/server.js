const express = require("express")
const multer = require("multer")
const {
  S3Client,
  PutObjectCommand,
  ListObjectsV2Command,
} = require("@aws-sdk/client-s3")

const app = express()
const upload = multer({ storage: multer.memoryStorage() })

// Configuration from environment variables
const PORT = process.env.PORT || 3000
const S3_ENDPOINT = process.env.S3_ENDPOINT || "http://s3.local"
const S3_BUCKET = process.env.S3_BUCKET || "s3-mirror"
const AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID || "dummy-key"
const AWS_SECRET_ACCESS_KEY =
  process.env.AWS_SECRET_ACCESS_KEY || "dummy-secret"
const FORCE_PATH_STYLE = process.env.FORCE_PATH_STYLE === "true"

// Initialize S3 client
const s3Client = new S3Client({
  endpoint: S3_ENDPOINT,
  region: "us-east-1",
  forcePathStyle: FORCE_PATH_STYLE, // Support both path-style and virtual-hosted style
  credentials: {
    accessKeyId: AWS_ACCESS_KEY_ID,
    secretAccessKey: AWS_SECRET_ACCESS_KEY,
  },
})

// Serve the upload form
app.get("/", (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>S3 Upload Test</title>
      <style>
        body {
          font-family: Arial, sans-serif;
          max-width: 600px;
          margin: 50px auto;
          padding: 20px;
        }
        h1 { color: #333; }
        form {
          border: 2px dashed #ccc;
          padding: 20px;
          border-radius: 5px;
        }
        input[type="file"] { margin: 10px 0; }
        button {
          background: #007bff;
          color: white;
          padding: 10px 20px;
          border: none;
          border-radius: 3px;
          cursor: pointer;
        }
        button:hover { background: #0056b3; }
        .message {
          margin: 20px 0;
          padding: 10px;
          border-radius: 3px;
        }
        .success { background: #d4edda; color: #155724; }
        .error { background: #f8d7da; color: #721c24; }
        .info { background: #d1ecf1; color: #0c5460; }
        ul { text-align: left; }
      </style>
    </head>
    <body>
      <h1>S3 Upload Test</h1>
      <div class="info message">
        <strong>Configuration:</strong><br>
        S3 Endpoint: ${S3_ENDPOINT}<br>
        Bucket: ${S3_BUCKET}<br>
        Style: ${
          FORCE_PATH_STYLE
            ? "Path-style (/bucket/key)"
            : "Virtual-hosted (bucket.domain/key)"
        }
      </div>
      <form action="/upload" method="post" enctype="multipart/form-data">
        <h3>Upload a file to S3</h3>
        <input type="file" name="file" required>
        <br><br>
        <button type="submit">Upload to S3</button>
      </form>
      <br>
      <a href="/list">View uploaded files</a>
    </body>
    </html>
  `)
})

// Handle file upload
app.post("/upload", upload.single("file"), async (req, res) => {
  if (!req.file) {
    return res.status(400).send("No file uploaded")
  }

  const key = `uploads/${Date.now()}-${req.file.originalname}`

  try {
    // Upload to S3
    const command = new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: key,
      Body: req.file.buffer,
      ContentType: req.file.mimetype,
    })

    await s3Client.send(command)

    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Upload Success</title>
        <style>
          body { font-family: Arial, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; }
          .success { background: #d4edda; color: #155724; padding: 15px; border-radius: 5px; }
          a { color: #007bff; }
        </style>
      </head>
      <body>
        <div class="success">
          <h2>✓ File uploaded successfully!</h2>
          <p><strong>File:</strong> ${req.file.originalname}</p>
          <p><strong>Size:</strong> ${(req.file.size / 1024).toFixed(2)} KB</p>
          <p><strong>S3 Key:</strong> ${key}</p>
          <p><strong>Bucket:</strong> ${S3_BUCKET}</p>
        </div>
        <br>
        <a href="/">← Upload another file</a> | <a href="/list">View all files</a>
      </body>
      </html>
    `)
  } catch (error) {
    console.error("S3 upload error:", error)
    res.status(500).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Upload Error</title>
        <style>
          body { font-family: Arial, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; }
          .error { background: #f8d7da; color: #721c24; padding: 15px; border-radius: 5px; }
          pre { background: #f5f5f5; padding: 10px; overflow-x: auto; }
        </style>
      </head>
      <body>
        <div class="error">
          <h2>✗ Upload failed</h2>
          <p>${error.message}</p>
          <pre>${error.stack}</pre>
        </div>
        <br>
        <a href="/">← Try again</a>
      </body>
      </html>
    `)
  }
})

// List uploaded files
app.get("/list", async (req, res) => {
  try {
    const command = new ListObjectsV2Command({
      Bucket: S3_BUCKET,
      Prefix: "uploads/",
    })

    const response = await s3Client.send(command)
    const files = response.Contents || []

    const fileList = files
      .map(
        (file) =>
          `<li>${file.Key} (${(file.Size / 1024).toFixed(2)} KB) - ${
            file.LastModified
          }</li>`
      )
      .join("")

    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Uploaded Files</title>
        <style>
          body { font-family: Arial, sans-serif; max-width: 800px; margin: 50px auto; padding: 20px; }
          h1 { color: #333; }
          ul { background: #f5f5f5; padding: 20px; border-radius: 5px; }
          .info { background: #d1ecf1; color: #0c5460; padding: 15px; border-radius: 5px; }
        </style>
      </head>
      <body>
        <h1>Files in S3 Bucket</h1>
        <div class="info">
          <strong>Bucket:</strong> ${S3_BUCKET}<br>
          <strong>Total files:</strong> ${files.length}
        </div>
        <br>
        ${
          files.length > 0
            ? `<ul>${fileList}</ul>`
            : "<p>No files uploaded yet.</p>"
        }
        <br>
        <a href="/">← Back to upload</a>
      </body>
      </html>
    `)
  } catch (error) {
    console.error("S3 list error:", error)
    res.status(500).send(`Error listing files: ${error.message}`)
  }
})

app.listen(PORT, () => {
  console.log(`S3 test app running on port ${PORT}`)
  console.log(`S3 Endpoint: ${S3_ENDPOINT}`)
  console.log(`S3 Bucket: ${S3_BUCKET}`)
})
