import express from 'express';
const router = express.Router();
import path from 'path';
import fs from 'fs'

/* GET home page. */
router.get('/', (req, res, next) => {
  console.log('grafittiData hit')
  res.json([
    {
      "tag": "lease",
      "items": [
        "Base rent + NNN (CAM, taxes, insurance)",
        "Rent escalations, lease term, renewal options",
        "Previous tenant concept & reason for leaving",
        "Vacancy length",
        "Hood system working & compliant",
        "Grease trap condition/size",
        "HVAC age/capacity",
        "Electrical load (3-phase, amps)",
        "Gas line capacity",
        "Plumbing/ADA compliant",
        "Walk-in cooler/freezer ownership & condition",
        "Fire suppression system",
        "Health department compliance",
        "Deferred maintenance/code violations",
        "Landlord vs tenant repair responsibilities",
        "Seating capacity/fire marshal approval",
        "Outdoor seating rights",
        "Signage/visibility",
        "Parking ratio"
      ]
    },
    {
      "tag": "franchise",
      "items": [
        "Franchise fee",
        "Build-out/investment ($500k+)",
        "Royalty fee %",
        "Marketing/ad fee %",
        "Working capital (6–12 months)",
        "Payback period (FDD Item 19)",
        "Owner salary allowed",
        "Projected EBITDA margins",
        "Agreement term",
        "Renewal options & fees",
        "Personal guarantee required",
        "Territory rights (exclusive/shared)",
        "Multi-unit obligations",
        "Termination clauses reviewed",
        "Transfer/sale terms & fees",
        "Approved vendors only",
        "Menu/pricing flexibility",
        "Mandated POS/tech",
        "Required hours",
        "Training standards",
        "Site selection assistance",
        "Marketing support",
        "Grand opening support",
        "Ongoing coaching",
        "Field visits schedule",
        "Break-even completed",
        "Resale/transfer options",
        "Transfer fee amount",
        "Exit strategy reviewed",
        "Owner presence required",
        "Training time commitment",
        "Average hours franchisees work/week"
      ]
    },
    {
      "tag": "city",
      "items": [
        "Business license covers entertainment",
        "Liquor license type matches concept",
        "Entertainment/cabaret/dance permit",
        "Late service permit",
        "Max serving hours (weekdays/weekends)",
        "Music cutoff time",
        "Outdoor vs indoor curfews",
        "Noise dB limits at property line",
        "Soundproofing requirements",
        "Max occupancy/fire marshal approval",
        "Security plan required",
        "Surveillance/crowd manager rules",
        "Zoning permits entertainment use",
        "Conditional use permit",
        "Distance restrictions (schools/churches)",
        "Last call rules",
        "Alcohol server training required",
        "To-go alcohol rules",
        "Extended-hours alcohol license",
        "Annual inspections (fire/health/building)",
        "Renewal cycles for permits",
        "Local/state liquor authority compliance"
      ]
    },
    {
      "tag": "operator_preopen",
      "items": [
        "All permits approved",
        "Inspections passed",
        "Certificate of occupancy in hand",
        "Kitchen equipment installed, tested, calibrated",
        "HVAC, hood, grease trap inspected",
        "POS and payment systems tested",
        "Security cameras, alarms, safes installed",
        "Furniture, fixtures, décor complete",
        "Phone/internet operational",
        "All staff hired",
        "Training manuals distributed",
        "Staff trained on POS, service, recipes, safety, alcohol compliance",
        "Uniforms ordered and distributed",
        "Soft opening schedule created",
        "Vendor accounts set up and deliveries scheduled",
        "Inventory system tested",
        "First food/beverage order placed",
        "Smallwares stocked",
        "Website live with menus & hours",
        "Social media campaigns running",
        "Local press/media outreach complete",
        "Grand opening announcement ready",
        "Soft opening invitations sent"
      ]
    },
    {
      "tag": "operator_postopen",
      "items": [
        "First 2 months’ P&L reviewed",
        "Break-even analysis checked",
        "Cash flow and payroll reviewed",
        "Inventory variance reports analyzed",
        "Vendor pricing reviewed",
        "Evaluate staff performance",
        "Conduct refresher training",
        "Establish scheduling rhythm",
        "Review labor % of sales",
        "Gather guest feedback",
        "Monitor repeat customer rate",
        "Update menu items based on sales",
        "Adjust seating/flow",
        "Evaluate ROI on marketing",
        "Establish loyalty program",
        "Build local partnerships",
        "Plan seasonal promotions",
        "Confirm permits/inspections valid",
        "Schedule recurring pest control/hood/HVAC maintenance",
        "Review safety logs and incidents"
      ]
    }
  ]);
})

export default router;
