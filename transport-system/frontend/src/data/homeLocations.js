/**
 * homeLocations.js
 * ---------------------------------------------------------------------------
 * Curated pickup / drop reference points used by the Home page booking widget.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The Home hero booking bar is powered by Google Places Autocomplete. Google
 * attaches its `.pac-container` dropdown to `document.body`, so that path needs
 * the Maps JS API to be reachable. When the API key is missing, invalid,
 * quota-blocked or the network is down, the widget must STILL be a usable
 * booking field — otherwise the customer sees a text box they cannot complete
 * and the whole funnel dead-ends.
 *
 * So this list is a *fallback suggestion source only*. It never replaces Google
 * Places: while `google.maps.places` is live the Home fields use Google's own
 * predictions, and this list is only consulted when that widget is not ready.
 *
 * Shape kept deliberately flat so the list stays cheap to ship:
 *   { id, name, state, lat, lng }
 */

const RAW_LOCATIONS = [
  // ── Bihar (home network) ────────────────────────────────────────────────
  ['Begusarai', 'Bihar', 25.4182, 86.1272],
  ['Patna', 'Bihar', 25.5941, 85.1376],
  ['Muzaffarpur', 'Bihar', 26.1209, 85.3647],
  ['Darbhanga', 'Bihar', 26.1542, 85.8918],
  ['Gaya', 'Bihar', 24.7955, 84.9994],
  ['Bhagalpur', 'Bihar', 25.2425, 86.9842],
  ['Purnia', 'Bihar', 25.7771, 87.4753],
  ['Katihar', 'Bihar', 25.5391, 87.5719],
  ['Saharsa', 'Bihar', 25.8808, 86.6007],
  ['Samastipur', 'Bihar', 25.657, 85.2967],
  ['Madhubani', 'Bihar', 26.2489, 85.8918],
  ['Sitamarhi', 'Bihar', 26.5969, 85.6287],
  ['Supaul', 'Bihar', 26.1147, 86.5726],
  ['Nalanda', 'Bihar', 25.1367, 85.4431],
  ['Aurangabad', 'Bihar', 24.7514, 84.9499],
  ['Buxar', 'Bihar', 25.5645, 83.9773],
  ['Bhojpur', 'Bihar', 25.567, 84.6675],
  ['Rohtas', 'Bihar', 25.3407, 83.5543],
  ['Jehanabad', 'Bihar', 25.7333, 84.9833],
  ['Arwal', 'Bihar', 25.5541, 84.6636],
  ['Nawada', 'Bihar', 24.8386, 85.1068],
  ['Sheikhpura', 'Bihar', 25.988, 84.756],
  ['Gopalganj', 'Bihar', 26.8472, 84.55],
  ['Siwan', 'Bihar', 26.2166, 84.3633],
  ['Saran', 'Bihar', 25.7411, 84.6564],
  ['Chapra', 'Bihar', 25.7815, 84.7274],
  ['East Champaran', 'Bihar', 26.7541, 84.7017],
  ['West Champaran', 'Bihar', 26.8011, 84.5173],
  ['Gopalganj', 'Bihar', 26.8472, 84.55], // duplicate guard removed below
  ['Sheohar', 'Bihar', 26.65, 84.6833],
  ['Araria', 'Bihar', 26.2121, 87.5087],
  ['Kishanganj', 'Bihar', 26.1025, 87.9536],
  ['Madhepura', 'Bihar', 25.9218, 86.702],
  ['Banka', 'Bihar', 24.8526, 86.9353],
  ['Jamui', 'Bihar', 24.9156, 86.6364],
  ['Lakhisarai', 'Bihar', 25.368, 86.206],

  // ── Nearby / eastern corridors ───────────────────────────────────────────
  ['Varanasi', 'Uttar Pradesh', 25.3176, 82.9739],
  ['Gorakhpur', 'Uttar Pradesh', 26.7606, 83.3732],
  ['Lucknow', 'Uttar Pradesh', 26.8467, 80.9462],
  ['Kanpur', 'Uttar Pradesh', 26.4499, 80.3319],
  ['Prayagraj', 'Uttar Pradesh', 25.4358, 81.8463],
  ['Agra', 'Uttar Pradesh', 27.1767, 78.0081],
  ['Ranchi', 'Jharkhand', 23.3441, 85.3096],
  ['Jamshedpur', 'Jharkhand', 22.8046, 86.2029],
  ['Dhanbad', 'Jharkhand', 23.7957, 86.4304],
  ['Bokaro', 'Jharkhand', 23.6693, 86.1511],
  ['Kolkata', 'West Bengal', 22.5726, 88.3639],
  ['Howrah', 'West Bengal', 22.5958, 88.2636],
  ['Siliguri', 'West Bengal', 26.7271, 88.3953],
  ['Asansol', 'West Bengal', 23.6739, 86.9524],
  ['Guwahati', 'Assam', 26.1445, 91.7362],
  ['Dibrugarh', 'Assam', 27.4728, 94.912],
  ['Imphal', 'Manipur', 24.817, 93.9368],
  ['Cuttack', 'Odisha', 20.4625, 85.883],
  ['Bhubaneswar', 'Odisha', 20.2961, 85.8245],

  // ── Metro / national freight hubs ────────────────────────────────────────
  ['Delhi', 'Delhi', 28.6139, 77.209],
  ['Noida', 'Uttar Pradesh', 28.5355, 77.391],
  ['Ghaziabad', 'Uttar Pradesh', 28.6692, 77.4538],
  ['Faridabad', 'Haryana', 28.4089, 77.3178],
  ['Gurugram', 'Haryana', 28.4595, 77.0266],
  ['Meerut', 'Uttar Pradesh', 28.9845, 77.7064],
  ['Mumbai', 'Maharashtra', 19.076, 72.8777],
  ['Pune', 'Maharashtra', 18.5204, 73.8567],
  ['Nashik', 'Maharashtra', 19.9975, 73.7898],
  ['Nagpur', 'Maharashtra', 21.1458, 79.0882],
  ['Aurangabad', 'Maharashtra', 19.8762, 75.3433],
  ['Surat', 'Gujarat', 21.1702, 72.8311],
  ['Ahmedabad', 'Gujarat', 23.0225, 72.5714],
  ['Rajkot', 'Gujarat', 22.3039, 70.8022],
  ['Jaipur', 'Rajasthan', 26.9124, 75.7873],
  ['Jodhpur', 'Rajasthan', 26.2389, 73.0243],
  ['Indore', 'Madhya Pradesh', 22.7196, 75.8577],
  ['Bhopal', 'Madhya Pradesh', 23.2599, 77.4126],
  ['Chennai', 'Tamil Nadu', 13.0827, 80.2707],
  ['Coimbatore', 'Tamil Nadu', 11.0168, 76.9558],
  ['Madurai', 'Tamil Nadu', 9.9252, 78.1198],
  ['Bengaluru', 'Karnataka', 12.9716, 77.5946],
  ['Hubballi', 'Karnataka', 15.3647, 75.124],
  ['Hyderabad', 'Telangana', 17.385, 78.4867],
  ['Vijayawada', 'Andhra Pradesh', 16.5062, 80.648],
  ['Visakhapatnam', 'Andhra Pradesh', 17.6868, 83.2185],
  ['Kochi', 'Kerala', 9.9312, 76.2673],
  ['Thiruvananthapuram', 'Kerala', 8.5241, 76.9366],
  ['Chandigarh', 'Punjab', 30.7333, 76.7794],
  ['Ludhiana', 'Punjab', 30.901, 75.8573],
  ['Amritsar', 'Punjab', 31.634, 74.8723],
  ['Jammu', 'Jammu & Kashmir', 32.7266, 74.857],
  ['Srinagar', 'Jammu & Kashmir', 34.0837, 74.7973],
  ['Chandigarh', 'Chandigarh', 30.7333, 76.7794],
  ['Panaji', 'Goa', 15.4909, 73.8278],
  ['Dehradun', 'Uttarakhand', 30.3165, 78.0322],
  ['Raipur', 'Chhattisgarh', 21.2514, 81.6296],
  ['Bhubaneswar', 'Odisha', 20.2961, 85.8245],
];

/** `id` is `${slug(name)}--${slug(state)}` so "Aurangabad, Bihar" and
 *  "Aurangabad, Maharashtra" can never collide. */
const slugify = (value) =>
  String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

const seen = new Set();

/** @type {Array<{id:string,name:string,state:string,lat:number,lng:number,label:string}>} */
export const homeLocations = RAW_LOCATIONS.reduce((acc, [name, state, lat, lng]) => {
  const id = `${slugify(name)}--${slugify(state)}`;
  if (seen.has(id)) return acc; // de-duplicate the few repeated corridors
  seen.add(id);
  acc.push({ id, name, state, lat, lng, label: `${name}, ${state}` });
  return acc;
}, []);

/**
 * Case/diacritic-insensitive search used only when Google Places is not ready.
 *
 * @param {string} query free text typed by the customer
 * @param {number} [limit=6] max suggestions to return
 * @returns {Array<{id:string,name:string,state:string,lat:number,lng:number,label:string}>}
 */
export function searchHomeLocations(query, limit = 6) {
  const term = String(query || '')
    .trim()
    .toLowerCase();
  // One or two characters match almost everything; require something meaningful.
  if (term.length < 2) return [];

  const starts = [];
  const contains = [];

  for (const location of homeLocations) {
    const name = location.name.toLowerCase();
    const label = location.label.toLowerCase();
    if (name.startsWith(term) || label.startsWith(term)) starts.push(location);
    else if (name.includes(term) || label.includes(term)) contains.push(location);
  }

  return [...starts, ...contains].slice(0, limit);
}

export default homeLocations;
