/////api/v1/models/helpers/crud.js **GPT NOTE: DONT REMOVE THIS LINE IN EXAMPLES**

import express from "express";
import fs from "fs";
import path from "path";
import { ObjectId } from "mongodb";
import { log } from "console";

const router = express.Router();

router.use(express.json()); // Ensure JSON parsing

// Utility function to dynamically load a model
async function loadModel(modelName) {
    try {
        const modelsDir = path.join(process.cwd(), "api/v1/models");
        const modelPath = path.join(modelsDir, `${modelName}.js`);
console.log(`modelPath:${modelPath} modelDir:${modelsDir}`)
        if (!fs.existsSync(modelPath)) {
            throw new Error(`Model ${modelName} not found`);
        }

        const { default: Model } = await import(`file://${modelPath}`);
        return new Model();
    } catch (error) {
        console.error("Error loading model:", error);
        throw error;
    }
}

// **CREATE a new document**
router.post("/:model", async (req, res) => {
    try {
        const modelName = req.params.model;
        const model = await loadModel(modelName);
console/log(req.body)
        const newDocument = await model.create(req.body);
        res.json(newDocument);
    } catch (error) {
        console.error("Error creating document:", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

// **READ all documents**
router.get("/:model", async (req, res) => {
    try {
        const modelName = req.params.model;
        const model = await loadModel(modelName);

        const documents = await model.getAll();
        res.json(documents);
    } catch (error) {
        console.error("Error fetching documents:", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

// **READ a single document by ID**
router.get("/:model/:id", async (req, res) => {
    try {
        const modelName = req.params.model;
        const model = await loadModel(modelName);

        if (!ObjectId.isValid(req.params.id)) {
            return res.status(400).json({ error: "Invalid ID format" });
        }

        const document = await model.getById(req.params.id);
        if (!document) return res.status(404).json({ error: "Document not found" });

        res.json(document);
    } catch (error) {
        console.error("Error fetching document:", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

// **UPDATE a document by ID**
router.put("/:model/:id", async (req, res) => {
    try {
        const modelName = req.params.model;
        const model = await loadModel(modelName);

        if (!ObjectId.isValid(req.params.id)) {
            return res.status(400).json({ error: "Invalid ID format" });
        }

        const updatedDocument = await model.updateById(req.params.id, req.body);
        if (!updatedDocument) return res.status(404).json({ error: "Document not found" });

        res.json(updatedDocument);
    } catch (error) {
        console.error("Error updating document:", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

// **DELETE a document by ID**
router.delete("/:model/:id", async (req, res) => {
    try {
        const modelName = req.params.model;
        const model = await loadModel(modelName);

        if (!ObjectId.isValid(req.params.id)) {
            return res.status(400).json({ error: "Invalid ID format" });
        }

        const deleted = await model.deleteById(req.params.id);
        if (!deleted) return res.status(404).json({ error: "Document not found" });

        res.json({ success: true });
    } catch (error) {
        console.error("Error deleting document:", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
});
router.get("/:model/search", async (req, res) => {
    try {
        const modelName = req.params.model;
        const query = req.query.q;

        if (!query) {
            return res.status(400).json({ error: "Search query is required" });
        }

        const model = await loadModel(modelName);

        // Perform a simple text search in the collection
        const searchResults = await model.getAll({
            $text: { $search: query } // Use MongoDB's text search
        });

        res.json(searchResults);
    } catch (error) {
        console.error("Error searching documents:", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

export default router;
