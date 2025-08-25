export default function generateFormFields(model) {
    const fields = model.modelFields;
    const formElements = {};
  console.log("Generating form fields for model:", JSON.stringify(model.modelFields));
    Object.keys(fields).forEach((key) => {
      const field = fields[key];
      
      // Only include fields that are explicitly editable (true)
      if (field.editable === true) {
        formElements[key] = {
          type: field.type,
          value: field.value ?? '',
        };
      }
    });
  
    return formElements;
  }
  