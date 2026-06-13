// Asset generation admin panel JavaScript

document.addEventListener('DOMContentLoaded', function() {
  const assetButtons = document.querySelectorAll('.asset-btn');
  const formContainers = document.querySelectorAll('.form-container');
  const alertBox = document.getElementById('alertBox');

  // Handle asset type selection
  assetButtons.forEach(button => {
    button.addEventListener('click', function() {
      const assetType = this.getAttribute('data-type');

      // Update button states
      assetButtons.forEach(btn => btn.classList.remove('active'));
      this.classList.add('active');

      // Show corresponding form
      formContainers.forEach(container => container.classList.remove('active'));
      const targetForm = document.getElementById(`form-${assetType}`);
      if (targetForm) {
        targetForm.classList.add('active');
        hideAlert();
      }
    });
  });

  // Handle form submissions
  const forms = {
    character: document.getElementById('characterForm'),
    zone: document.getElementById('zoneForm'),
    item: document.getElementById('itemForm'),
    species: document.getElementById('speciesForm'),
    quest: document.getElementById('questForm'),
    npc: document.getElementById('npcForm')
  };

  Object.keys(forms).forEach(assetType => {
    const form = forms[assetType];
    if (form) {
      form.addEventListener('submit', async function(e) {
        e.preventDefault();

        const formData = new FormData(form);
        const assetData = {};

        // Convert FormData to object
        for (let [key, value] of formData.entries()) {
          // Handle checkboxes
          if (form.elements[key] && form.elements[key].type === 'checkbox') {
            assetData[key] = form.elements[key].checked;
          }
          // Handle numbers
          else if (form.elements[key] && form.elements[key].type === 'number') {
            assetData[key] = value ? Number(value) : null;
          }
          // Handle text arrays (like quest objectives)
          else if (key === 'objectives' && value) {
            assetData[key] = value.split('\n').filter(line => line.trim());
          }
          else {
            assetData[key] = value;
          }
        }

        // Submit the data
        await submitAsset(assetType, assetData, form);
      });
    }
  });

  async function submitAsset(assetType, assetData, form) {
    const submitButton = form.querySelector('.btn-submit');
    submitButton.disabled = true;
    submitButton.textContent = 'Creating...';

    try {
      const response = await fetch('/admin/api/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          assetType: assetType,
          assetData: assetData
        })
      });

      const result = await response.json();

      if (result.success) {
        showAlert('success', result.message || `${assetType} created successfully!`);
        form.reset();

        // Log the created asset
        console.log('Created asset:', result.data);
      } else {
        showAlert('error', result.error || 'Failed to create asset');
      }
    } catch (error) {
      console.error('Error:', error);
      showAlert('error', 'Network error: Failed to create asset');
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = `Create ${assetType.charAt(0).toUpperCase() + assetType.slice(1)}`;
    }
  }

  function showAlert(type, message) {
    alertBox.className = `alert alert-${type} show`;
    alertBox.textContent = message;

    // Auto-hide after 5 seconds
    setTimeout(() => {
      hideAlert();
    }, 5000);
  }

  function hideAlert() {
    alertBox.className = 'alert';
    alertBox.textContent = '';
  }

  // Handle stackable checkbox for items
  const stackableCheckbox = document.getElementById('item_stackable');
  const stackSizeInput = document.getElementById('item_stackSize');

  if (stackableCheckbox && stackSizeInput) {
    stackableCheckbox.addEventListener('change', function() {
      stackSizeInput.disabled = !this.checked;
      if (!this.checked) {
        stackSizeInput.value = 1;
      }
    });

    // Initialize state
    stackSizeInput.disabled = !stackableCheckbox.checked;
  }
});
