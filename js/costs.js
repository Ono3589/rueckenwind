// Kostenvergleich Auto vs. E-Bike, gerechnet aus deinen Fahrzeugdaten – keine Pauschale.

export const FUEL = {
  benzin: { label: 'Benzin', unit: 'l', co2KgPerUnit: 2.37 },
  diesel: { label: 'Diesel', unit: 'l', co2KgPerUnit: 2.65 },
  hybrid: { label: 'Hybrid (Benzin)', unit: 'l', co2KgPerUnit: 2.37 },
  elektro: { label: 'Elektro', unit: 'kWh', co2KgPerUnit: null }, // aus Strommix
};

const CHARGE_EFFICIENCY = 0.85; // Ladeverluste E-Bike
const per = (yearly, km) => (km > 0 ? yearly / km : 0);

export function carCostPerKm(car) {
  const energy = (car.consumption / 100) * car.energyPrice;
  const wear = per(car.maintenance + car.tires, car.annualKm);
  const fixed = per(car.insurance + car.tax + car.depreciation, car.annualKm);
  const total = car.mode === 'voll' ? energy + wear + fixed : energy + wear;
  return { energy, wear, fixed, total };
}

export function carCo2KgPerKm(car, gridGPerKWh) {
  const f = FUEL[car.fuel] ?? FUEL.benzin;
  const perUnit = f.co2KgPerUnit ?? gridGPerKWh / 1000;
  return (car.consumption / 100) * perUnit;
}

export function bikeCostPerKm(bike) {
  const energy = (bike.whPerKm / 1000 / CHARGE_EFFICIENCY) * bike.electricityPrice;
  const wear = per(bike.maintenance, bike.annualKm);
  return { energy, wear, total: energy + wear };
}

export function bikeCo2KgPerKm(bike, gridGPerKWh) {
  return (bike.whPerKm / 1000 / CHARGE_EFFICIENCY) * (gridGPerKWh / 1000);
}

export function bikeRangeKm(bike) {
  return bike.whPerKm > 0 ? bike.batteryWh / bike.whPerKm : 0;
}

export function estimateKcal(km, minutes, person, avgSpeed) {
  const hours = minutes ? minutes / 60 : km / (avgSpeed || 20);
  return Math.round(person.met * person.weightKg * hours);
}

// Kennzahlen für eine Menge an Fahrten
export function summarize(rides, state) {
  const car = carCostPerKm(state.car);
  const bike = bikeCostPerKm(state.bike);
  const co2Car = carCo2KgPerKm(state.car, state.co2.gridGPerKWh);
  const co2Bike = bikeCo2KgPerKm(state.bike, state.co2.gridGPerKWh);

  const km = rides.reduce((s, r) => s + r.km, 0);
  const kcal = rides.reduce((s, r) => s + (r.kcal || 0), 0);
  const days = new Set(rides.map((r) => r.date)).size;
  const parking = days * (state.car.parkingPerDay || 0);
  const saved = km * (car.total - bike.total) + parking;
  const co2Kg = km * (co2Car - co2Bike);
  const fuelSaved = (km * state.car.consumption) / 100; // l oder kWh

  // Entfernungspauschale: einfache Strecke je Arbeitstag, an dem du gefahren bist
  const taxKm = days * state.route.distanceKm;
  const taxAmount = taxKm * state.tax.ratePerKm;

  return { km, kcal, days, rides: rides.length, saved, parking, co2Kg, fuelSaved, taxKm, taxAmount, perKm: { car, bike } };
}
