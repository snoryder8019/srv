export default function generateFormFields(model) {
    const fields = model.modelFields;
    const formElements = {};
  
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
  