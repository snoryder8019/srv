/**
 * Asset Suggestion System
 * Allows users to suggest improvements to assets
 */

function openSuggestionModal(assetId, assetName) {
  if (!window.USER_ID) {
    alert('Please log in to suggest improvements');
    window.location.href = '/auth';
    return;
  }

  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.id = 'suggestionModal';

  modal.innerHTML = '<div class="modal-content suggestion-modal">' +
    '<div class="modal-header">' +
      '<h2>Suggest Improvements</h2>' +
      '<p>Asset: <strong>' + assetName + '</strong></p>' +
      '<button class="modal-close" onclick="closeSuggestionModal()">&times;</button>' +
    '</div>' +
    '<form id="suggestionForm" enctype="multipart/form-data">' +
      '<input type="hidden" name="assetId" value="' + assetId + '">' +

      '<div class="form-section">' +
        '<h3>Description</h3>' +
        '<textarea name="text" placeholder="Describe your suggested improvements..." rows="4"></textarea>' +
      '</div>' +

      '<div class="form-section">' +
        '<h3>Field Changes (Optional)</h3>' +
        '<div class="field-changes" id="fieldChanges">' +
          '<div class="field-change-row">' +
            '<select name="fieldName" class="field-name-select">' +
              '<option value="">Select Field</option>' +
              '<option value="title">Title</option>' +
              '<option value="description">Description</option>' +
              '<option value="lore">Lore</option>' +
              '<option value="backstory">Backstory</option>' +
              '<option value="flavor">Flavor Text</option>' +
            '</select>' +
            '<input type="text" name="fieldValue" placeholder="New value" class="field-value-input">' +
          '</div>' +
        '</div>' +
        '<button type="button" class="btn btn-secondary" onclick="addFieldChange()">+ Add Field</button>' +
      '</div>' +

      '<div class="form-section">' +
        '<h3>Image Uploads (Optional)</h3>' +
        '<div class="image-upload-grid">' +
          '<div class="image-upload-item">' +
            '<label>Pixel Art</label>' +
            '<input type="file" name="pixelArt" accept="image/png,image/jpg,image/jpeg" onchange="previewImage(this, \'pixelArtPreview\')">' +
            '<div id="pixelArtPreview" class="image-preview"></div>' +
          '</div>' +
          '<div class="image-upload-item">' +
            '<label>Fullscreen</label>' +
            '<input type="file" name="fullscreen" accept="image/png,image/jpg,image/jpeg" onchange="previewImage(this, \'fullscreenPreview\')">' +
            '<div id="fullscreenPreview" class="image-preview"></div>' +
          '</div>' +
          '<div class="image-upload-item">' +
            '<label>Index Card</label>' +
            '<input type="file" name="indexCard" accept="image/png,image/jpg,image/jpeg" onchange="previewImage(this, \'indexCardPreview\')">' +
            '<div id="indexCardPreview" class="image-preview"></div>' +
          '</div>' +
        '</div>' +
      '</div>' +

      '<div class="modal-actions">' +
        '<button type="button" class="btn btn-secondary" onclick="closeSuggestionModal()">Cancel</button>' +
        '<button type="submit" class="btn btn-primary">Submit Suggestion</button>' +
      '</div>' +
    '</form>' +
  '</div>';

  document.body.appendChild(modal);

  document.getElementById('suggestionForm').addEventListener('submit', submitSuggestion);
}

function closeSuggestionModal() {
  const modal = document.getElementById('suggestionModal');
  if (modal) {
    modal.remove();
  }
}

function addFieldChange() {
  const container = document.getElementById('fieldChanges');
  const newRow = document.createElement('div');
  newRow.className = 'field-change-row';
  newRow.innerHTML = '<select name="fieldName" class="field-name-select">' +
      '<option value="">Select Field</option>' +
      '<option value="title">Title</option>' +
      '<option value="description">Description</option>' +
      '<option value="lore">Lore</option>' +
      '<option value="backstory">Backstory</option>' +
      '<option value="flavor">Flavor Text</option>' +
    '</select>' +
    '<input type="text" name="fieldValue" placeholder="New value" class="field-value-input">' +
    '<button type="button" class="btn-remove" onclick="this.parentElement.remove()">&times;</button>';

  container.appendChild(newRow);
}

function previewImage(input, previewId) {
  const preview = document.getElementById(previewId);

  if (input.files) {
    if (input.files[0]) {
      const reader = new FileReader();

      reader.onload = function(e) {
        preview.innerHTML = '<img src="' + e.target.result + '" alt="Preview">';
      };

      reader.readAsDataURL(input.files[0]);
    }
  }
}

async function submitSuggestion(e) {
  e.preventDefault();

  const form = e.target;
  const formData = new FormData(form);
  const assetId = formData.get('assetId');

  const fieldChanges = {};
  const fieldRows = document.querySelectorAll('.field-change-row');

  fieldRows.forEach(row => {
    const nameSelect = row.querySelector('.field-name-select');
    const valueInput = row.querySelector('.field-value-input');

    if (nameSelect.value) {
      if (valueInput.value.trim()) {
        fieldChanges[nameSelect.value] = valueInput.value.trim();
      }
    }
  });

  const submitData = new FormData();
  submitData.append('text', formData.get('text'));
  submitData.append('fieldChanges', JSON.stringify(fieldChanges));

  if (formData.get('pixelArt').size > 0) {
    submitData.append('pixelArt', formData.get('pixelArt'));
  }
  if (formData.get('fullscreen').size > 0) {
    submitData.append('fullscreen', formData.get('fullscreen'));
  }
  if (formData.get('indexCard').size > 0) {
    submitData.append('indexCard', formData.get('indexCard'));
  }

  try {
    const response = await fetch('/api/v1/assets/' + assetId + '/suggestions', {
      method: 'POST',
      credentials: 'same-origin',
      body: submitData
    });

    const data = await response.json();

    if (response.ok) {
      alert('Suggestion submitted successfully!');
      closeSuggestionModal();
    } else {
      alert('Error: ' + (data.error || 'Failed to submit suggestion'));
    }
  } catch (error) {
    console.error('Error submitting suggestion:', error);
    alert('Failed to submit suggestion. Please try again.');
  }
}
