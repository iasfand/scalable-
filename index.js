const express = require("express");
const multer = require("multer");
const sharp = require("sharp");
const archiver = require("archiver");
const fs = require("fs/promises");
const fsSync = require("fs"); // for read/write streams
const cors = require("cors");
const path = require("path");
const { PDFDocument } = require("pdf-lib");

const app = express();
const upload = multer({
    dest: path.join(__dirname, "uploads/"),
    limits: { fileSize: 20 * 1024 * 1024 } // 20MB limit
});

app.use(cors());

// Validate PDF file
const validatePDF = async (filePath) => {
    try {
        const fileContents = await fs.readFile(filePath);
        return fileContents.toString().startsWith('%PDF-');
    } catch {
        return false;
    }
};

// Safe delete function
const safeUnlink = async (filePath) => {
    try {
        await fs.unlink(filePath);
    } catch (err) {
        if (err.code !== 'ENOENT') {
            console.error(`Error deleting file: ${filePath}`, err);
        }
    }
};

app.post("/compress", upload.single("file"), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
    }

    try {
        const filePath = req.file.path;
        const fileExt = path.extname(req.file.originalname).toLowerCase();
        const fileName = path.basename(req.file.originalname, fileExt);
        const outputDir = path.join(__dirname, "uploads");

        const supportedTypes = {
            text: [".txt", ".log", ".json"],
            image: [".jpg", ".jpeg", ".png", ".webp"],
            pdf: [".pdf"],
            word: [".doc", ".docx"],
            other: [".zip", ".gz", ".rar", ".7z"]
        };

        const isSupported = Object.values(supportedTypes).flat().includes(fileExt);
        if (!isSupported) {
            await safeUnlink(filePath);
            return res.status(400).json({ error: "Unsupported file type" });
        }

        let compressedFilePath;

        if (supportedTypes.text.includes(fileExt)) {
            compressedFilePath = path.join(outputDir, `${fileName}.gz`);
            const gzip = require("zlib").createGzip();
            const readStream = fsSync.createReadStream(filePath);
            const writeStream = fsSync.createWriteStream(compressedFilePath);
            readStream.pipe(gzip).pipe(writeStream);

            await new Promise((resolve, reject) => {
                writeStream.on("finish", resolve);
                writeStream.on("error", reject);
            });

        } else if (supportedTypes.image.includes(fileExt)) {
            compressedFilePath = path.join(outputDir, `compressed-${req.file.originalname}`);

            const image = sharp(filePath).resize({ width: 600, withoutEnlargement: true });

            if (fileExt === ".jpg" || fileExt === ".jpeg") {
                await image.jpeg({
                    quality: 30,
                    progressive: true,
                    mozjpeg: true
                }).toFile(compressedFilePath);

            } else if (fileExt === ".png") {
                await image.png({
                    compressionLevel: 9,
                    palette: true
                }).toFile(compressedFilePath);

            } else if (fileExt === ".webp") {
                await image.webp({
                    quality: 30,
                    lossless: false
                }).toFile(compressedFilePath);
            }

        } else if (supportedTypes.pdf.includes(fileExt)) {
            const isValidPDF = await validatePDF(filePath);
            if (!isValidPDF) {
                await safeUnlink(filePath);
                return res.status(400).json({
                    error: "Invalid PDF file",
                    details: "The uploaded file is not a valid PDF document"
                });
            }

            const fileContents = await fs.readFile(filePath);
            const pdfDoc = await PDFDocument.load(fileContents);
            const pdfBytes = await pdfDoc.save({ updateMetadata: false, useObjectStreams: true });

            compressedFilePath = path.join(outputDir, `compressed-${req.file.originalname}`);
            await fs.writeFile(compressedFilePath, pdfBytes);

        } else if (supportedTypes.word.includes(fileExt) || supportedTypes.other.includes(fileExt)) {
            compressedFilePath = path.join(outputDir, `${fileName}.zip`);
            const output = fsSync.createWriteStream(compressedFilePath);
            const archive = archiver('zip', { zlib: { level: 9 } });

            archive.pipe(output);
            archive.file(filePath, { name: req.file.originalname });
            await archive.finalize();

            await new Promise((resolve, reject) => {
                output.on("close", resolve);
                output.on("error", reject);
            });
        }

        await safeUnlink(filePath);

        res.download(compressedFilePath, `compressed-${req.file.originalname}`, async () => {
            try {
                await safeUnlink(compressedFilePath);
            } catch (err) {
                console.error("Failed to delete compressed file:", err);
            }
        });

    } catch (error) {
        console.error("Compression Error:", error);
        try {
            await safeUnlink(req.file?.path);
        } catch { }
        res.status(500).json({ error: "Compression failed", details: error.message });
    }
});

app.listen(5000, () => console.log("✅ Server running on port 5000"));
