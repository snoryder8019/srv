////plugins/mongo/helpers/models.js **GPT NOTE: DONT REMOVE THIS LINE IN EXAMPLES**

import { getDb } from '../../../../plugins/mongo/mongo.js';
import { ObjectId } from 'mongodb';

export default class ModelHelper {
  constructor(collectionName) {
    this.collectionName = collectionName;
    this.modelFields = {};
  }

  async create(document) {
    const db = getDb();
    const collection = db.collection(this.collectionName);
    const processedDocument = this.processData(document);
    const result = await collection.insertOne(processedDocument);
    return result.insertedId ? await collection.findOne({ _id: result.insertedId }) : null;
  }

  async getAll(query = {}) {
    const db = getDb();
    return await db.collection(this.collectionName).find(query).toArray();
  }

  async getById(id) {
    if (!ObjectId.isValid(id)) throw new Error('Invalid ID format');
    const db = getDb();
    return await db.collection(this.collectionName).findOne({ _id: new ObjectId(id) });
  }

  async updateById(id, updatedDocument) {
    if (!ObjectId.isValid(id)) throw new Error('Invalid ID format');
    const db = getDb();
    const processedDocument = this.processData(updatedDocument);
    const result = await db.collection(this.collectionName).updateOne(
      { _id: new ObjectId(id) },
      { $set: processedDocument }
    );
    return result.matchedCount > 0 ? await this.getById(id) : null;
  }

  async deleteById(id) {
    if (!ObjectId.isValid(id)) throw new Error('Invalid ID format');
    const db = getDb();
    const result = await db.collection(this.collectionName).deleteOne({ _id: new ObjectId(id) });
    return result.deletedCount > 0;
  }
  processData(data) {
    const processedData = {};
    console.log("Processing data:", data); // Debug incoming data
    console.log("Model Fields:", this.modelFields); // Debug model fields

    if (!this.modelFields || Object.keys(this.modelFields).length === 0) {
        console.warn("Warning: modelFields is empty, returning data as-is");
        return data; // Return data as-is if no model fields defined
    }

    for (const key in this.modelFields) {
        if (data[key] !== undefined) {
            processedData[key] = this.castValue(data[key], this.modelFields[key].type);
        }
    }

    // Include createdAt if provided and not in modelFields
    if (data.createdAt && !this.modelFields.createdAt) {
        processedData.createdAt = data.createdAt;
    }

    console.log("Processed data ready for DB:", processedData); // Debug processed data
    return processedData;
}


  castValue(value, type) {
    switch (type) {
      case 'number': return Number(value);
      case 'boolean': return Boolean(value);
      case 'array': return Array.isArray(value) ? value : [value];
      case 'object': return typeof value === 'object' ? value : JSON.parse(value);
      case 'date': return new Date(value);
      default: return String(value);
    }
  }


  
}
