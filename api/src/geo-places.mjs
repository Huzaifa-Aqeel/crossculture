// Reference data for naming Qloo where-popular map cells. Each country lists
// major metro areas with a representative coordinate; a cell is named after
// the nearest metro within its radius, otherwise it stays unnamed.

export const MARKETS = {
  US: "United States", CA: "Canada", GB: "United Kingdom", IE: "Ireland",
  AU: "Australia", NZ: "New Zealand", DE: "Germany", FR: "France", NL: "Netherlands",
};

const METROS = {
  US: [["New York", 40.71, -74.0], ["Los Angeles", 34.05, -118.24], ["Chicago", 41.88, -87.63],
    ["Houston", 29.76, -95.37], ["Phoenix", 33.45, -112.07], ["Philadelphia", 39.95, -75.17],
    ["San Antonio", 29.42, -98.49], ["San Diego", 32.72, -117.16], ["Dallas", 32.78, -96.8],
    ["Austin", 30.27, -97.74], ["San Francisco", 37.77, -122.42], ["San Jose", 37.34, -121.89],
    ["Seattle", 47.61, -122.33], ["Portland", 45.52, -122.68], ["Denver", 39.74, -104.99],
    ["Boston", 42.36, -71.06], ["Washington, DC", 38.9, -77.04], ["Baltimore", 39.29, -76.61],
    ["Nashville", 36.16, -86.78], ["Atlanta", 33.75, -84.39], ["Miami", 25.76, -80.19],
    ["Tampa", 27.95, -82.46], ["Orlando", 28.54, -81.38], ["Charlotte", 35.23, -80.84],
    ["Raleigh", 35.78, -78.64], ["Minneapolis", 44.98, -93.27], ["Detroit", 42.33, -83.05],
    ["Columbus", 39.96, -83.0], ["Cleveland", 41.5, -81.69], ["Pittsburgh", 40.44, -80.0],
    ["Indianapolis", 39.77, -86.16], ["Kansas City", 39.1, -94.58], ["St. Louis", 38.63, -90.2],
    ["Milwaukee", 43.04, -87.91], ["Salt Lake City", 40.76, -111.89], ["Las Vegas", 36.17, -115.14],
    ["Sacramento", 38.58, -121.49], ["Orange County", 33.72, -117.83], ["Riverside", 33.95, -117.4],
    ["New Orleans", 29.95, -90.07], ["Charleston", 32.78, -79.93], ["Savannah", 32.08, -81.09],
    ["Asheville", 35.6, -82.55], ["Richmond", 37.54, -77.44], ["Louisville", 38.25, -85.76],
    ["Cincinnati", 39.1, -84.51], ["Oklahoma City", 35.47, -97.52], ["Albuquerque", 35.08, -106.65],
    ["Tucson", 32.22, -110.97], ["Boise", 43.62, -116.2], ["Honolulu", 21.31, -157.86],
    ["Anchorage", 61.22, -149.9], ["Hartford", 41.76, -72.68], ["Providence", 41.82, -71.41],
    ["Buffalo", 42.89, -78.88], ["Madison", 43.07, -89.4], ["Santa Barbara", 34.42, -119.7],
    ["Destin", 30.39, -86.5], ["Waco", 31.55, -97.15], ["Fort Worth", 32.76, -97.33],
    ["Long Island", 40.79, -73.13], ["Fairfield County", 41.14, -73.26], ["Burlington", 44.48, -73.21]],
  CA: [["Toronto", 43.65, -79.38], ["Montreal", 45.5, -73.57], ["Vancouver", 49.28, -123.12],
    ["Calgary", 51.05, -114.07], ["Edmonton", 53.55, -113.49], ["Ottawa", 45.42, -75.7],
    ["Winnipeg", 49.9, -97.14], ["Quebec City", 46.81, -71.21], ["Halifax", 44.65, -63.58],
    ["Victoria", 48.43, -123.37]],
  GB: [["London", 51.51, -0.13], ["Manchester", 53.48, -2.24], ["Birmingham", 52.49, -1.9],
    ["Leeds", 53.8, -1.55], ["Glasgow", 55.86, -4.25], ["Edinburgh", 55.95, -3.19],
    ["Liverpool", 53.41, -2.98], ["Bristol", 51.45, -2.59], ["Brighton", 50.82, -0.14],
    ["Oxford", 51.75, -1.26], ["Cambridge", 52.21, 0.12], ["Newcastle", 54.98, -1.62],
    ["Cardiff", 51.48, -3.18], ["Belfast", 54.6, -5.93], ["Nottingham", 52.95, -1.15]],
  IE: [["Dublin", 53.35, -6.26], ["Cork", 51.9, -8.47], ["Galway", 53.27, -9.05]],
  AU: [["Sydney", -33.87, 151.21], ["Melbourne", -37.81, 144.96], ["Brisbane", -27.47, 153.03],
    ["Perth", -31.95, 115.86], ["Adelaide", -34.93, 138.6], ["Canberra", -35.28, 149.13],
    ["Gold Coast", -28.02, 153.4], ["Hobart", -42.88, 147.33]],
  NZ: [["Auckland", -36.85, 174.76], ["Wellington", -41.29, 174.78], ["Christchurch", -43.53, 172.64]],
  DE: [["Berlin", 52.52, 13.4], ["Hamburg", 53.55, 9.99], ["Munich", 48.14, 11.58],
    ["Cologne", 50.94, 6.96], ["Frankfurt", 50.11, 8.68], ["Stuttgart", 48.78, 9.18],
    ["Düsseldorf", 51.23, 6.77], ["Leipzig", 51.34, 12.37]],
  FR: [["Paris", 48.86, 2.35], ["Lyon", 45.76, 4.84], ["Marseille", 43.3, 5.37],
    ["Bordeaux", 44.84, -0.58], ["Lille", 50.63, 3.06], ["Toulouse", 43.6, 1.44],
    ["Nice", 43.71, 7.26], ["Nantes", 47.22, -1.55]],
  NL: [["Amsterdam", 52.37, 4.9], ["Rotterdam", 51.92, 4.48], ["The Hague", 52.07, 4.3],
    ["Utrecht", 52.09, 5.12], ["Eindhoven", 51.44, 5.47]],
};

const RADIUS_KM = 80;
function distanceKm(lat1, lon1, lat2, lon2) {
  const rad = (value) => value * Math.PI / 180;
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(a));
}

export function nearestMetro(latitude, longitude, country) {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  let best = null;
  for (const [name, lat, lon] of METROS[country] ?? []) {
    const km = distanceKm(latitude, longitude, lat, lon);
    if (km <= RADIUS_KM && (!best || km < best.km)) best = { name, km };
  }
  return best?.name ?? null;
}
