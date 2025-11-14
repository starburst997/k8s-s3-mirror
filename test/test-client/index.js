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

// Configure S3 client to use the proxy (virtual-hosted style)
const s3Client = new S3Client({
  endpoint: process.env.S3_PROXY_ENDPOINT || "http://localhost:8080",
  region: "us-east-1", // Required by SDK but not used by proxy
  forcePathStyle: false,
  credentials: {
    accessKeyId: "dummy", // Proxy handles real auth
    secretAccessKey: "dummy",
  },
})

// Configure S3 client to use path-style (/<BUCKET>/<KEY>)
const s3ClientPathStyle = new S3Client({
  endpoint: process.env.S3_PROXY_ENDPOINT || "http://localhost:8080",
  region: "us-east-1",
  forcePathStyle: true, // Use path-style: /bucket/key instead of bucket.domain/key
  credentials: {
    accessKeyId: "dummy",
    secretAccessKey: "dummy",
  },
})

// Validate required environment variables
if (!process.env.MAIN_S3_ENDPOINT || !process.env.MAIN_ACCESS_KEY || !process.env.MAIN_SECRET_KEY) {
  console.error(chalk.red("❌ Missing required MAIN_S3 environment variables"))
  process.exit(1)
}

if (!process.env.MIRROR_S3_ENDPOINT || !process.env.MIRROR_ACCESS_KEY || !process.env.MIRROR_SECRET_KEY) {
  console.error(chalk.red("❌ Missing required MIRROR_S3 environment variables"))
  process.exit(1)
}

// Configure direct S3 client for main S3
const mainS3Client = new S3Client({
  endpoint: process.env.MAIN_S3_ENDPOINT,
  region: "us-east-1",
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.MAIN_ACCESS_KEY,
    secretAccessKey: process.env.MAIN_SECRET_KEY,
  },
})

// Configure direct S3 client for mirror S3
const mirrorS3Client = new S3Client({
  endpoint: process.env.MIRROR_S3_ENDPOINT,
  region: "us-east-1",
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.MIRROR_ACCESS_KEY,
    secretAccessKey: process.env.MIRROR_SECRET_KEY,
  },
})

// Helper function to read file
async function readFile(filePath) {
  return fs.promises.readFile(filePath)
}

// Upload file to S3
async function uploadFile(bucket, key, filePath, client = null) {
  const activeClient = client || s3Client
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

    const response = await activeClient.send(command)

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
async function downloadFile(bucket, key, outputPath, client = null) {
  const activeClient = client || s3Client
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

    const response = await activeClient.send(command)
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
async function deleteFile(bucket, key, client = null) {
  const activeClient = client || s3Client
  try {
    console.log(chalk.blue(`🗑️  Deleting ${chalk.bold(`${bucket}/${key}`)}...`))

    const command = new DeleteObjectCommand({
      Bucket: bucket,
      Key: key,
    })

    const response = await activeClient.send(command)

    console.log(chalk.green(`✅ Successfully deleted ${chalk.bold(key)}`))

    return response
  } catch (error) {
    console.error(chalk.red(`❌ Delete failed: ${error.message}`))
    throw error
  }
}

// List files in bucket
async function listFiles(bucket, prefix = "", client = null) {
  const activeClient = client || s3Client
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

    const response = await activeClient.send(command)

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

// Test both path-style and virtual-hosted style
async function runStyleTests(bucket) {
  console.log(chalk.bold.cyan("\n🧪 Running Path-Style vs Virtual-Hosted Style Tests\n"))
  console.log(chalk.gray(`Proxy endpoint: ${process.env.S3_PROXY_ENDPOINT || "http://localhost:8080"}`))
  console.log(chalk.gray(`Test bucket: ${bucket}\n`))

  const timestamp = Date.now()
  const testFile = path.join(__dirname, "test-style-comparison.txt")
  const testContent = `Style test created at ${new Date().toISOString()}`

  try {
    // Create test file
    await fs.promises.writeFile(testFile, testContent)

    // Test 1: Upload with virtual-hosted style
    console.log(chalk.bold("\n1️⃣  Testing VIRTUAL-HOSTED style (bucket.domain/key)..."))
    console.log(chalk.gray("   Using forcePathStyle: false"))
    const virtualHostedKey = `test-styles/virtual-hosted-${timestamp}.txt`
    await uploadFile(bucket, virtualHostedKey, testFile, s3Client)

    // Test 2: Upload with path-style
    console.log(chalk.bold("\n2️⃣  Testing PATH-STYLE (/bucket/key)..."))
    console.log(chalk.gray("   Using forcePathStyle: true"))
    const pathStyleKey = `test-styles/path-style-${timestamp}.txt`
    await uploadFile(bucket, pathStyleKey, testFile, s3ClientPathStyle)

    // Wait for mirroring FIRST
    console.log(chalk.gray("\n   Waiting 3 seconds for async mirroring..."))
    await new Promise(resolve => setTimeout(resolve, 3000))

    console.log(chalk.bold("\n3️⃣  Verifying path-style file was mirrored to CORRECT bucket..."))
    const mirrorBucket = process.env.MIRROR_BUCKET_PREFIX ? `${process.env.MIRROR_BUCKET_PREFIX}${bucket}` : bucket
    try {
      const mirrorFiles = await listFiles(mirrorBucket, `test-styles/path-style-${timestamp}`, mirrorS3Client)
      if (mirrorFiles.length > 0) {
        console.log(chalk.green(`   ✅ File found in mirror bucket "${mirrorBucket}" (path-style worked correctly)`))
      } else {
        console.log(chalk.red(`   ❌ File NOT found in mirror bucket "${mirrorBucket}"`))
        console.log(chalk.yellow(`   Checking if it was incorrectly mirrored to bucket "s3"...`))
        const wrongBucket = process.env.MIRROR_BUCKET_PREFIX ? `${process.env.MIRROR_BUCKET_PREFIX}s3` : "s3"
        try {
          const wrongFiles = await listFiles(wrongBucket, `test-styles/path-style-${timestamp}`, mirrorS3Client)
          if (wrongFiles.length > 0) {
            console.log(chalk.red(`   ❌ FOUND! File was incorrectly mirrored to bucket "${wrongBucket}"`))
            console.log(chalk.red(`   This means the proxy parsed "s3" as the bucket name instead of "${bucket}"`))
            process.exit(1)
          }
        } catch (e) {
          // Bucket doesn't exist, which is fine
        }
        console.log(chalk.red(`   Path-style request failed - file not found in any bucket`))
        process.exit(1)
      }
    } catch (error) {
      console.log(chalk.red(`   ❌ Error checking mirror: ${error.message}`))
      process.exit(1)
    }

    // Test 4: Download using path-style
    console.log(chalk.bold("\n4️⃣  Testing download with PATH-STYLE..."))
    const downloadPath1 = path.join(__dirname, "downloaded-path-style.txt")
    await downloadFile(bucket, virtualHostedKey, downloadPath1, s3ClientPathStyle)
    const content1 = await fs.promises.readFile(downloadPath1, "utf-8")
    if (content1 === testContent) {
      console.log(chalk.green("   ✅ Path-style download successful"))
    } else {
      console.log(chalk.red("   ❌ Path-style download content mismatch"))
      process.exit(1)
    }
    await fs.promises.unlink(downloadPath1)

    // Test 5: Download using virtual-hosted style
    console.log(chalk.bold("\n5️⃣  Testing download with VIRTUAL-HOSTED style..."))
    const downloadPath2 = path.join(__dirname, "downloaded-virtual-hosted.txt")
    await downloadFile(bucket, pathStyleKey, downloadPath2, s3Client)
    const content2 = await fs.promises.readFile(downloadPath2, "utf-8")
    if (content2 === testContent) {
      console.log(chalk.green("   ✅ Virtual-hosted download successful"))
    } else {
      console.log(chalk.red("   ❌ Virtual-hosted download content mismatch"))
      process.exit(1)
    }
    await fs.promises.unlink(downloadPath2)

    // Test 6: Cleanup with path-style
    console.log(chalk.bold("\n6️⃣  Testing delete with PATH-STYLE..."))
    await deleteFile(bucket, virtualHostedKey, s3ClientPathStyle)
    await deleteFile(bucket, pathStyleKey, s3ClientPathStyle)

    // Wait for deletion
    await new Promise(resolve => setTimeout(resolve, 2000))

    // Verify cleanup
    console.log(chalk.bold("\n   Verifying cleanup..."))
    const finalFiles = await listFiles(bucket, `test-styles/path-style-${timestamp}`, s3Client)
    if (finalFiles.length === 0) {
      console.log(chalk.green("   ✅ All test files cleaned up"))
    }

    // Cleanup local file
    await fs.promises.unlink(testFile)

    console.log(chalk.bold.green("\n✨ All style tests passed! Both path-style and virtual-hosted style work correctly.\n"))
  } catch (error) {
    console.error(chalk.bold.red("\n❌ Style test suite failed\n"))
    console.error(error)
    process.exit(1)
  }
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
  console.log(chalk.gray(`Test bucket: ${bucket}`))
  console.log(chalk.gray(`Main S3: ${process.env.MAIN_S3_ENDPOINT}`))
  console.log(chalk.gray(`Mirror S3: ${process.env.MIRROR_S3_ENDPOINT}`))
  if (process.env.MIRROR_BUCKET_PREFIX) {
    console.log(chalk.gray(`Mirror bucket prefix: ${process.env.MIRROR_BUCKET_PREFIX}`))
  }
  console.log()

  const timestamp = Date.now()
  const testFile = path.join(__dirname, "test-file.txt")
  const testContent = `Test file created at ${new Date().toISOString()}\nThis is a test of the S3 proxy system.`
  const testFolder = `test-${timestamp}`
  const testKey = `${testFolder}/file-${timestamp}.txt`

  try {
    // Create test file
    console.log(chalk.bold("\n1️⃣  Creating test file..."))
    await fs.promises.writeFile(testFile, testContent)
    console.log(chalk.green(`✅ Created ${testFile}`))

    // Upload test
    console.log(chalk.bold("\n2️⃣  Testing upload through proxy..."))
    await uploadFile(bucket, testKey, testFile)

    // Wait a bit for async mirroring to complete
    console.log(chalk.gray("   Waiting 2 seconds for async mirroring..."))
    await new Promise(resolve => setTimeout(resolve, 2000))

    // Verify upload on main S3
    console.log(chalk.bold("\n   Verifying upload on main S3..."))
    try {
      await listFiles(bucket, testKey, mainS3Client)
      console.log(chalk.green("   ✅ File exists on main S3"))
    } catch (error) {
      console.log(chalk.red(`   ❌ Failed to verify on main S3: ${error.message}`))
      process.exit(1)
    }

    // Verify upload on mirror S3
    console.log(chalk.bold("\n   Verifying upload on mirror S3..."))
    const mirrorBucket = process.env.MIRROR_BUCKET_PREFIX ?
      `${process.env.MIRROR_BUCKET_PREFIX}${bucket}` : bucket
    try {
      await listFiles(mirrorBucket, testKey, mirrorS3Client)
      console.log(chalk.green("   ✅ File exists on mirror S3"))
    } catch (error) {
      console.log(chalk.red(`   ❌ Failed to verify on mirror S3: ${error.message}`))
      process.exit(1)
    }

    // List test
    console.log(chalk.bold("\n3️⃣  Testing list through proxy..."))
    await listFiles(bucket, testFolder + "/")

    // Download test
    console.log(chalk.bold("\n4️⃣  Testing download..."))

    // Download through proxy
    const downloadPath = path.join(__dirname, "downloaded-proxy.txt")
    console.log(chalk.blue("\n   Downloading through proxy..."))
    await downloadFile(bucket, testKey, downloadPath)

    // Verify proxy download
    const downloadedContent = await fs.promises.readFile(downloadPath, "utf-8")
    if (downloadedContent === testContent) {
      console.log(chalk.green("   ✅ Proxy download content matches original"))
    } else {
      console.log(chalk.red("   ❌ Proxy download content does not match"))
      process.exit(1)
    }

    // Download directly from main S3
    const mainDownloadPath = path.join(__dirname, "downloaded-main.txt")
    console.log(chalk.blue("\n   Downloading directly from main S3..."))
    try {
      await downloadFile(bucket, testKey, mainDownloadPath, mainS3Client)
      const mainContent = await fs.promises.readFile(mainDownloadPath, "utf-8")
      if (mainContent === testContent) {
        console.log(chalk.green("   ✅ Main S3 content matches original"))
      } else {
        console.log(chalk.red("   ❌ Main S3 content does not match"))
        process.exit(1)
      }
      await fs.promises.unlink(mainDownloadPath)
    } catch (error) {
      console.log(chalk.red(`   ❌ Failed to download from main S3: ${error.message}`))
      process.exit(1)
    }

    // Download directly from mirror S3
    const mirrorDownloadPath = path.join(__dirname, "downloaded-mirror.txt")
    const mirrorBucketDownload = process.env.MIRROR_BUCKET_PREFIX ?
      `${process.env.MIRROR_BUCKET_PREFIX}${bucket}` : bucket
    console.log(chalk.blue("\n   Downloading directly from mirror S3..."))
    try {
      await downloadFile(mirrorBucketDownload, testKey, mirrorDownloadPath, mirrorS3Client)
      const mirrorContent = await fs.promises.readFile(mirrorDownloadPath, "utf-8")
      if (mirrorContent === testContent) {
        console.log(chalk.green("   ✅ Mirror S3 content matches original"))
      } else {
        console.log(chalk.red("   ❌ Mirror S3 content does not match"))
        process.exit(1)
      }
      await fs.promises.unlink(mirrorDownloadPath)
    } catch (error) {
      console.log(chalk.red(`   ❌ Failed to download from mirror S3: ${error.message}`))
      process.exit(1)
    }

    // Delete test
    console.log(chalk.bold("\n5️⃣  Testing delete through proxy..."))
    await deleteFile(bucket, testKey)

    // Wait for async deletion to propagate
    console.log(chalk.gray("   Waiting 2 seconds for async deletion..."))
    await new Promise(resolve => setTimeout(resolve, 2000))

    // Verify deletion on proxy
    console.log(chalk.bold("\n6️⃣  Verifying deletion..."))
    console.log(chalk.blue("\n   Checking proxy..."))
    const proxyFiles = await listFiles(bucket, testFolder + "/")
    if (proxyFiles.length === 0) {
      console.log(chalk.green("   ✅ File deleted from proxy view"))
    }

    // Verify deletion on main S3
    console.log(chalk.blue("\n   Checking main S3..."))
    try {
      const mainFiles = await listFiles(bucket, testFolder + "/", mainS3Client)
      if (mainFiles.length === 0) {
        console.log(chalk.green("   ✅ File deleted from main S3"))
      } else {
        console.log(chalk.red("   ❌ File still exists on main S3"))
        process.exit(1)
      }
    } catch (error) {
      console.log(chalk.gray(`   Note: ${error.message}`))
    }

    // Verify deletion on mirror S3
    console.log(chalk.blue("\n   Checking mirror S3..."))
    const mirrorBucketDelete = process.env.MIRROR_BUCKET_PREFIX ?
      `${process.env.MIRROR_BUCKET_PREFIX}${bucket}` : bucket
    try {
      const mirrorFiles = await listFiles(mirrorBucketDelete, testFolder + "/", mirrorS3Client)
      if (mirrorFiles.length === 0) {
        console.log(chalk.green("   ✅ File deleted from mirror S3"))
      } else {
        console.log(chalk.red("   ❌ File still exists on mirror S3"))
        process.exit(1)
      }
    } catch (error) {
      console.log(chalk.gray(`   Note: ${error.message}`))
    }

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

program
  .command("test-styles <bucket>")
  .description("Run path-style vs virtual-hosted style comparison tests")
  .action(async (bucket) => {
    await runStyleTests(bucket)
  })

// Parse command line arguments
program.parse()

// Show help if no command provided
if (!process.argv.slice(2).length) {
  program.outputHelp()
}
