#!/usr/bin/env node

import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3"
import chalk from "chalk"
import { program } from "commander"
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Configure S3 client to use the proxy
const s3Client = new S3Client({
  endpoint: process.env.S3_PROXY_ENDPOINT || "http://localhost:8080",
  region: "us-east-1", // Required by SDK but not used by proxy
  forcePathStyle: false,
  credentials: {
    accessKeyId: "dummy", // Proxy handles real auth
    secretAccessKey: "dummy",
  },
})

// Helper function to read file
async function readFile(filePath) {
  return fs.promises.readFile(filePath)
}

// Upload file to S3
async function uploadFile(bucket, key, filePath) {
  try {
    console.log(
      chalk.blue(
        `📤 Uploading ${chalk.bold(filePath)} to ${chalk.bold(
          `${bucket}/${key}`
        )}...`
      )
    )

    const fileContent = await readFile(filePath)
    const fileStats = fs.statSync(filePath)

    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: fileContent,
      ContentType: getContentType(filePath),
      Metadata: {
        "original-filename": path.basename(filePath),
        "upload-time": new Date().toISOString(),
      },
    })

    const response = await s3Client.send(command)

    console.log(chalk.green(`✅ Successfully uploaded ${chalk.bold(key)}`))
    console.log(chalk.gray(`   Size: ${fileStats.size} bytes`))
    console.log(chalk.gray(`   ETag: ${response.ETag}`))

    return response
  } catch (error) {
    console.error(chalk.red(`❌ Upload failed: ${error.message}`))
    throw error
  }
}

// Download file from S3
async function downloadFile(bucket, key, outputPath) {
  try {
    console.log(
      chalk.blue(
        `📥 Downloading ${chalk.bold(`${bucket}/${key}`)} to ${chalk.bold(
          outputPath
        )}...`
      )
    )

    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    })

    const response = await s3Client.send(command)
    const stream = response.Body

    // Convert stream to buffer
    const chunks = []
    for await (const chunk of stream) {
      chunks.push(chunk)
    }
    const buffer = Buffer.concat(chunks)

    await fs.promises.writeFile(outputPath, buffer)

    console.log(
      chalk.green(`✅ Successfully downloaded to ${chalk.bold(outputPath)}`)
    )
    console.log(chalk.gray(`   Size: ${buffer.length} bytes`))
    console.log(chalk.gray(`   Content-Type: ${response.ContentType}`))

    return response
  } catch (error) {
    console.error(chalk.red(`❌ Download failed: ${error.message}`))
    throw error
  }
}

// Delete file from S3
async function deleteFile(bucket, key) {
  try {
    console.log(chalk.blue(`🗑️  Deleting ${chalk.bold(`${bucket}/${key}`)}...`))

    const command = new DeleteObjectCommand({
      Bucket: bucket,
      Key: key,
    })

    const response = await s3Client.send(command)

    console.log(chalk.green(`✅ Successfully deleted ${chalk.bold(key)}`))

    return response
  } catch (error) {
    console.error(chalk.red(`❌ Delete failed: ${error.message}`))
    throw error
  }
}

// List files in bucket
async function listFiles(bucket, prefix = "") {
  try {
    console.log(
      chalk.blue(
        `📋 Listing files in ${chalk.bold(bucket)}${
          prefix ? ` with prefix ${chalk.bold(prefix)}` : ""
        }...`
      )
    )

    const command = new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix,
      MaxKeys: 100,
    })

    const response = await s3Client.send(command)

    if (!response.Contents || response.Contents.length === 0) {
      console.log(chalk.yellow("   No files found"))
      return []
    }

    console.log(chalk.green(`✅ Found ${response.Contents.length} file(s):\n`))

    response.Contents.forEach((obj) => {
      const size = `${obj.Size} bytes`.padEnd(15)
      const modified = new Date(obj.LastModified).toLocaleString()
      console.log(chalk.gray(`   ${size} ${modified} ${chalk.white(obj.Key)}`))
    })

    return response.Contents
  } catch (error) {
    console.error(chalk.red(`❌ List failed: ${error.message}`))
    throw error
  }
}

// Get content type based on file extension
function getContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase()
  const types = {
    ".txt": "text/plain",
    ".json": "application/json",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".pdf": "application/pdf",
    ".html": "text/html",
    ".css": "text/css",
    ".js": "application/javascript",
    ".xml": "application/xml",
    ".zip": "application/zip",
  }
  return types[ext] || "application/octet-stream"
}

// Run all tests
async function runTests(bucket) {
  console.log(chalk.bold.cyan("\n🧪 Running S3 Proxy Test Suite\n"))
  console.log(
    chalk.gray(
      `Proxy endpoint: ${
        process.env.S3_PROXY_ENDPOINT || "http://localhost:8080"
      }`
    )
  )
  console.log(chalk.gray(`Test bucket: ${bucket}\n`))

  const testFile = path.join(__dirname, "test-file.txt")
  const testContent = `Test file created at ${new Date().toISOString()}\nThis is a test of the S3 proxy system.`

  try {
    // Create test file
    console.log(chalk.bold("\n1️⃣  Creating test file..."))
    await fs.promises.writeFile(testFile, testContent)
    console.log(chalk.green(`✅ Created ${testFile}`))

    // Upload test
    console.log(chalk.bold("\n2️⃣  Testing upload..."))
    await uploadFile(bucket, "test/file.txt", testFile)

    // List test
    console.log(chalk.bold("\n3️⃣  Testing list..."))
    await listFiles(bucket, "test/")

    // Download test
    console.log(chalk.bold("\n4️⃣  Testing download..."))
    const downloadPath = path.join(__dirname, "downloaded-file.txt")
    await downloadFile(bucket, "test/file.txt", downloadPath)

    // Verify content
    const downloadedContent = await fs.promises.readFile(downloadPath, "utf-8")
    if (downloadedContent === testContent) {
      console.log(chalk.green("✅ Downloaded content matches original"))
    } else {
      console.log(chalk.red("❌ Downloaded content does not match"))
    }

    // Delete test
    console.log(chalk.bold("\n5️⃣  Testing delete..."))
    await deleteFile(bucket, "test/file.txt")

    // Verify deletion
    console.log(chalk.bold("\n6️⃣  Verifying deletion..."))
    await listFiles(bucket, "test/")

    // Cleanup
    await fs.promises.unlink(testFile)
    await fs.promises.unlink(downloadPath)

    console.log(chalk.bold.green("\n✨ All tests passed successfully!\n"))
  } catch (error) {
    console.error(chalk.bold.red("\n❌ Test suite failed\n"))
    console.error(error)
    process.exit(1)
  }
}

// CLI setup
program
  .name("s3-proxy-test")
  .description("Test CLI for S3 proxy")
  .version("1.0.0")

program
  .command("upload <bucket> <key> <file>")
  .description("Upload a file to S3 through the proxy")
  .action(async (bucket, key, file) => {
    try {
      await uploadFile(bucket, key, file)
    } catch (error) {
      process.exit(1)
    }
  })

program
  .command("download <bucket> <key> <output>")
  .description("Download a file from S3 through the proxy")
  .action(async (bucket, key, output) => {
    try {
      await downloadFile(bucket, key, output)
    } catch (error) {
      process.exit(1)
    }
  })

program
  .command("delete <bucket> <key>")
  .description("Delete a file from S3 through the proxy")
  .action(async (bucket, key) => {
    try {
      await deleteFile(bucket, key)
    } catch (error) {
      process.exit(1)
    }
  })

program
  .command("list <bucket> [prefix]")
  .description("List files in an S3 bucket")
  .action(async (bucket, prefix) => {
    try {
      await listFiles(bucket, prefix)
    } catch (error) {
      process.exit(1)
    }
  })

program
  .command("test <bucket>")
  .description("Run all tests with the specified bucket")
  .action(async (bucket) => {
    await runTests(bucket)
  })

// Parse command line arguments
program.parse()

// Show help if no command provided
if (!process.argv.slice(2).length) {
  program.outputHelp()
}
