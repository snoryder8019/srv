import express from "express";
import chalk from "chalk";
import fs from "fs";
import generateFormFields from "../../api/v1/models/helpers/fields.js";
import path from "path";

const router = express.Router();

async function isAustins(req, res, next) {
    const user = req.user;
   // console.log(`user:`, user);
    if (user && user.isAustins === true) {
        return next();
    } else {
        return res.status(401).send("Unauthorized");
    }
}

router.get("/", isAustins, async (req, res) => {
    try {
        // Define the absolute path to the models directory
        const modelsDir = path.join(process.cwd(), "api/v1/models/recipes");
        
        // Read directory contents and filter only JavaScript files
        const modelFiles = fs.readdirSync(modelsDir)
            .filter(file => file.endsWith(".js")) // Keep only JS files
            .map(file => path.basename(file, ".js")); // Remove file extensions

        const user = req.user;
        res.render("recipes", { user, models: modelFiles });

    } catch (error) {
        console.error(error);
        res.status(500).send("Internal Server Error");
    }
});
router.get("/fields", async (req, res) => {
    try {
        const modelName = req.query.model;  // Get model name from query string
        if (!modelName) return res.status(400).json({ error: "Model name is required" });

        const modelsDir = path.join(process.cwd(), "api/v1/models/recipes/");
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
