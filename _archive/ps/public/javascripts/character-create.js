// Character creation form handler
document.getElementById('createCharacterForm').addEventListener('submit', async (e) => {
  e.preventDefault();

  const formData = {
    name: document.getElementById('name').value,
    species: document.getElementById('species').value,
    stringDomain: document.getElementById('stringDomain').value,
    primaryClass: document.getElementById('primaryClass').value,
    homeStar: '',
    homePlanet: '',
    traits: ''
  };

  // Set home star and planet based on species selection
  switch (formData.species) {
    case 'Silicates':
      formData.homeStar = 'Alantir';
      formData.homePlanet = 'Zirion';
      break;
    case 'Lanterns':
      formData.homeStar = 'Umbraxis';
      formData.homePlanet = 'Umbraxis Prime';
      break;
    case 'Devan':
      formData.homeStar = 'Seraphon';
      formData.homePlanet = 'Astralara';
      break;
    case 'Humans':
      formData.homeStar = 'Sol';
      formData.homePlanet = 'Earth';
      break;
  }

  try {
    const response = await fetch('/api/v1/characters', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(formData)
    });

    const data = await response.json();

    if (response.ok) {
      alert('Character created successfully!');
      window.location.href = '/characters/' + data.character._id;
    } else {
      alert(data.error || 'Failed to create character');
    }
  } catch (err) {
    console.error('Character creation error:', err);
    alert('Failed to create character. Please try again.');
  }
});

// Update class options based on species selection
document.getElementById('species').addEventListener('change', (e) => {
  const species = e.target.value;
  const classInput = document.getElementById('primaryClass');

  // Clear previous value
  classInput.value = '';

  // Set placeholder based on species
  switch (species) {
    case 'Silicates':
      classInput.placeholder = 'e.g., Chronomancer, Crystal Weaver, Era Shifter';
      break;
    case 'Lanterns':
      classInput.placeholder = 'e.g., Void Engineer, Tech Sage, Umbral Scout';
      break;
    case 'Devan':
      classInput.placeholder = 'e.g., Covenant Guardian, Faithbinder, Astral Merchant';
      break;
    case 'Humans':
      classInput.placeholder = 'e.g., Warfire Vanguard, Primal Survivor, Steelborn Tactician';
      break;
    default:
      classInput.placeholder = 'Enter primary class';
  }
});
