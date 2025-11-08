import mongoose from "mongoose";

const ingredientSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true
  },
  quantity: String,
  unit: String,
  notes: String
}, { _id: false });

const instructionSchema = new mongoose.Schema({
  step: {
    type: Number,
    required: true
  },
  description: {
    type: String,
    required: true
  },
  imageUrl: String,
  timing: String
}, { _id: false });

const recipeSchema = new mongoose.Schema(
  {
    brandId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Brand",
      required: true
    },
    name: {
      type: String,
      required: true
    },
    description: {
      type: String,
      required: true
    },
    category: {
      type: String,
      enum: ["kitchen", "bar"],
      required: true
    },
    subcategory: {
      type: String // appetizer, entree, dessert, cocktail, beer, wine, etc.
    },
    ingredients: [ingredientSchema],
    instructions: [instructionSchema],
    prepTime: Number, // in minutes
    cookTime: Number, // in minutes
    servings: Number,
    imageUrls: [String],
    allergens: [String],
    dietaryInfo: [String], // vegetarian, vegan, gluten-free, etc.
    cost: Number,
    price: Number,
    active: {
      type: Boolean,
      default: true
    },
    visibility: {
      type: String,
      enum: ["full", "menu-only"], // full = chefs/bartenders see full recipe, menu-only = servers see only menu description
      default: "full"
    },
    menuDescription: {
      type: String // What servers/guests see
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },
    lastUpdatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User"
    }
  },
  {
    timestamps: true
  }
);

// Indexes
recipeSchema.index({ brandId: 1, category: 1, active: 1 });
recipeSchema.index({ brandId: 1, name: 1 });
recipeSchema.index({ brandId: 1, subcategory: 1 });

const Recipe = mongoose.model("Recipe", recipeSchema);

export default Recipe;
