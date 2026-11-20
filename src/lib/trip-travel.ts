/**
 * Shared trip travel math (office -> venues -> office), used by the inspection
 * engine. Moved here unchanged from the removed repair engine. Pure.
 */

export type LatLng = { lat: number; lng: number };

/** Injectable stand-in for the prototype's window.Geo. */
export type GeoAdapter = {
  driveMiles(a: LatLng, b: LatLng): number | null;
  driveMinutes(a: LatLng, b: LatLng): number | null;
};

export type TripVenueInput = {
  label?: string;
  coords?: LatLng | null;
  oneWayMiles?: number | string | null;
  oneWayMin?: number | string | null;
};

export type TripLeg = {
  from: string;
  to: string;
  miles: number | null;
  minutes: number | null;
};

export type TripTravel = {
  miles: number;
  minutesRaw: number;
  minutes: number;
  mileageCost: number;
  timeCost: number;
  total: number;
  method: "route" | "estimate";
  legs: TripLeg[];
};

export function roundUpTo(min: number | null | undefined, step?: number): number {
  if (min == null || isNaN(min)) return 0;
  step = step || 15;
  return Math.ceil(min / step) * step;
}

/** The travel knobs tripTravel reads. */
export type TravelRates = { laborRate: number; mileageRate: number; travelRoundMin: number };

/**
 * Shared trip travel over the whole route: office -> v1 -> ... -> vn -> office.
 * Same approach as the flame-test engine so both price travel identically.
 */
export function tripTravel(
  office: { lat?: number | null; lng?: number | null } | null | undefined,
  venues: TripVenueInput[],
  C: TravelRates,
  geo?: GeoAdapter | null
): TripTravel {
  const legs: TripLeg[] = [];
  let miles = 0;
  let minutes = 0;
  let method: "route" | "estimate" = "route";
  const haveGeo = !!geo;
  const coordVenues = venues.filter(
    (v) => v.coords && v.coords.lat != null && v.coords.lng != null
  );

  if (
    haveGeo &&
    geo &&
    office &&
    office.lat != null &&
    coordVenues.length === venues.length &&
    venues.length
  ) {
    const seq: LatLng[] = ([office as LatLng] as LatLng[])
      .concat(venues.map((v) => v.coords as LatLng))
      .concat([office as LatLng]);
    const labels = ["Office"]
      .concat(venues.map((v) => v.label || "Venue"))
      .concat(["Office"]);
    for (let i = 0; i < seq.length - 1; i++) {
      const m = geo.driveMiles(seq[i], seq[i + 1]);
      const t = geo.driveMinutes(seq[i], seq[i + 1]);
      if (m != null) miles += m;
      if (t != null) minutes += t;
      legs.push({ from: labels[i], to: labels[i + 1], miles: m, minutes: t });
    }
  } else {
    method = "estimate";
    let maxMi = 0;
    let maxMin = 0;
    venues.forEach((v) => {
      const mi = Number(v.oneWayMiles) || 0;
      if (mi > maxMi) {
        maxMi = mi;
        maxMin = Number(v.oneWayMin) || 0;
      }
    });
    miles = maxMi * 2;
    minutes = maxMin * 2;
  }

  const minutesBilled = roundUpTo(minutes, C.travelRoundMin);
  const mileageCost = miles * C.mileageRate;
  const timeCost = (minutesBilled / 60) * C.laborRate;
  return {
    miles: Math.round(miles),
    minutesRaw: Math.round(minutes),
    minutes: minutesBilled,
    mileageCost,
    timeCost,
    total: mileageCost + timeCost,
    method,
    legs,
  };
}
