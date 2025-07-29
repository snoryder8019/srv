import express from "express";
import chalk from "chalk";
import fs from "fs";
import generateFormFields from "../../api/v1/models/helpers/fields.js";
import path from "path";
import Signup from "../../api/v1/models/Form1.js"; // Add this import
import { getDb } from "../../plugins/mongo/mongo.js"; // Import getDb


const router = express.Router();



router.get("/", async (req, res) => {
    try {
        // Define the absolute path to the models directory
        const modelsDir = path.join(process.cwd(), "api/v1/models/forms");
        
        // Read directory contents and filter only JavaScript files
        const modelFiles = fs.readdirSync(modelsDir)
            .filter(file => file.endsWith(".js")) // Keep only JS files
            .map(file => path.basename(file, ".js")); // Remove file extensions

        const user = req.user;
        res.render("forms", { user, models: modelFiles });

    } catch (error) {
        console.error(error);
        res.status(500).send("Internal Server Error");
    }
});

router.post("/signup1", async (req, res) => {
    try {
        const { name, email, phone } = req.body;

        if (!name || !email || !phone) {
            return res.status(400).json({ error: "All fields are required" });
        }

        const db = getDb(); // Get the native MongoDB connection
        await db.collection("signups").insertOne({ name, email, phone });

        res.status(201).json({ message: "Info sent successfully" });
    } catch (error) {
        console.error("Error signing up:", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
});
router.get("/fields", async (req, res) => {
    try {
        const modelName = req.query.model;  // Get model name from query string
        if (!modelName) return res.status(400).json({ error: "Model name is required" });

        const modelsDir = path.join(process.cwd(), "api/v1/models/forms/");
        const modelPath = path.join(modelsDir, `${modelName}.js`);

        console.log(`Looking for model at: ${modelPath}`);

        if (!fs.existsSync(modelPath)) {
            console.error(`Model not found: ${modelName}`);
            return res.status(404).json({ error: `Model ${modelName} not found` });
        }

        console.log(`Importing model: file://${modelPath}`);
        const { default: Model } = await import(`file://${modelPath}`);

        if (!Model?.modelFields) {
            console.error(`No fields found for model: ${modelName}`);
            return res.status(404).json({ error: "Model fields not found" });
        }

        console.log(`Model fields retrieved successfully for: ${modelName}`);

        const modelFields = generateFormFields(Model);
        res.json(modelFields);
    } catch (error) {
        console.error("Error fetching model fields:", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
});


export default router;
