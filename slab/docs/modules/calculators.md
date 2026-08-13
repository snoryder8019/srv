# Calculators

Build pricing estimators at `/admin/calculators`.

A calculator is an interactive quote form you drop onto your site. Visitors enter their details, see an instant estimate, and click through to book. You define the inputs and what each one costs.

## Creating a Calculator
Every calculator needs a title and a short slug — a lowercase, hyphenated name like `roof-cost` that identifies it on your site and can't be changed later.

You can also set:

- **Description** — a line of intro text above the form
- **Note text** — the fine print under the estimate, for example "Estimate only — final price confirmed on inspection"
- **Button label and link** — where the call-to-action sends people, such as your booking page
- **On / Off** — a calculator that's off disappears from your site but keeps its setup

## Input Types
There are three kinds of input. Mix as many of each as you need.

| Type | How it works | Good for |
|------|--------------|----------|
| Base field | A number the visitor types, multiplied by your cost per unit | Length in feet, square footage, weight |
| Multiplier field | A whole-number count, multiplied by your cost each | Number of rooms, units, windows |
| Add-on | An optional extra, either a checkbox or a quantity | Upgrades, warranties, extra services |

Each base and multiplier field takes a label, a minimum, a maximum, and a cost per unit. The minimum and maximum keep visitors inside figures you can actually quote.

Add-ons come in two flavors:

- **Checkbox** — ticked or not, adds a flat cost
- **Count** — the visitor picks a quantity up to a maximum you set, and each one adds its cost

## How the Estimate Adds Up
Every base field, multiplier field, and add-on contributes its own amount, and the total is shown live as the visitor types. There's no hidden markup or minimum — the estimate is exactly the sum of what you configured, rounded to whole dollars.

## Previewing
The edit page shows a working copy of your calculator underneath the form. Save your changes and the preview updates, so you can try the numbers before anyone else sees them.

## Putting It On Your Site
Each calculator has a copy-ready embed snippet on its edit page. Paste it into a custom page or section wherever you want the form to appear.

The calculator picks up your brand colors, and its accent, background, text, and border can all be styled to match the section it sits in.

## Managing Calculators
The main list shows every calculator with its slug, how many inputs it has, whether it's on or off, and its embed snippet ready to copy.

Deleting a calculator is permanent, and any page still embedding it will show a not-found message. Switching it off is the safer way to retire one.
