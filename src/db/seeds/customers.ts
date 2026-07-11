import type { CustomerDoc } from "@/lib/stores/customers";

/**
 * Customer directory seed — verbatim port of dirSeed() from app/customers.js
 * (which mirrors the authoring records in Customers.dc.html). Names, ids,
 * coordinates, venueKinds and contacts are the spec — do not edit here.
 * Exported as a function per the seeds contract (this one has no relative
 * dates, but the call-at-seed-time shape matches the other seed modules).
 */
export function customersSeed(): CustomerDoc[] {
  return [
    {
      id: "lakefront",
      name: "Lakefront Performing Arts Center",
      type: "Performing arts",
      location: "Milwaukee, WI",
      locations: [
        { id: "lf1", label: "Main Hall", primary: true, city: "Milwaukee", state: "WI", lat: 43.043, lng: -87.910, venueKind: "proscenium", travelMiles: null, travelMin: null },
        { id: "lf2", label: "Studio Theatre", primary: false, city: "Milwaukee", state: "WI", lat: 43.043, lng: -87.910, venueKind: "blackbox", travelMiles: null, travelMin: null },
      ],
      contacts: [
        { name: "Dana Whitlock", role: "Facilities Director", email: "dwhitlock@lakefrontpac.org", primary: true },
        { name: "Tom Reyes", role: "Technical Director", email: "treyes@lakefrontpac.org", primary: false },
      ],
    },
    {
      id: "northridge",
      name: "North Ridge High School",
      type: "Education",
      location: "Appleton, WI",
      locations: [
        { id: "nr1", label: "Main Auditorium", primary: true, city: "Appleton", state: "WI", lat: 44.300, lng: -88.391, venueKind: "proscenium", travelMiles: null, travelMin: null },
      ],
      contacts: [
        { name: "Greg Salas", role: "Auditorium Manager", email: "gsalas@northridgehs.edu", primary: true },
      ],
    },
    {
      id: "badger",
      name: "Badger Ballet Company",
      type: "Performing arts",
      location: "Madison, WI",
      locations: [
        { id: "bb1", label: "Main Stage", primary: true, city: "Madison", state: "WI", lat: 43.075, lng: -89.391, venueKind: "proscenium", travelMiles: null, travelMin: null },
        { id: "bb2", label: "Rehearsal Studio", primary: false, city: "Madison", state: "WI", lat: 43.075, lng: -89.391, venueKind: "flat", travelMiles: null, travelMin: null },
      ],
      contacts: [
        { name: "Priya Anand", role: "Production Manager", email: "priya@badgerballet.org", primary: true },
        { name: "Karl Vogt", role: "Head Carpenter", email: "kvogt@badgerballet.org", primary: false },
      ],
    },
    {
      id: "lakeside",
      name: "Lakeside Community Church",
      type: "Worship",
      location: "Oshkosh, WI",
      locations: [
        { id: "lc1", label: "Sanctuary", primary: true, city: "Oshkosh", state: "WI", lat: 44.052, lng: -88.543, venueKind: "church", travelMiles: null, travelMin: null },
      ],
      contacts: [
        { name: "Pastor Liam Boyd", role: "Operations", email: "liam@lakesidechurch.org", primary: true },
      ],
    },
    {
      id: "northshore",
      name: "Northshore Theater",
      type: "Civic",
      location: "Sheboygan, WI",
      locations: [
        { id: "ns1", label: "Main House", primary: true, city: "Sheboygan", state: "WI", lat: 43.748, lng: -87.711, venueKind: "proscenium", travelMiles: null, travelMin: null },
      ],
      contacts: [
        { name: "Susan Marsh", role: "Operations Director", email: "smarsh@northshoretheater.org", primary: true },
      ],
    },
    {
      id: "bayfront",
      name: "Bayfront Arena",
      type: "Commercial",
      location: "Green Bay, WI",
      locations: [
        { id: "ba1", label: "Arena Floor", primary: true, city: "Green Bay", state: "WI", lat: 44.502, lng: -88.061, venueKind: "arena", travelMiles: null, travelMin: null },
      ],
      contacts: [
        { name: "Derek Cole", role: "Venue Operations", email: "dcole@bayfrontarena.com", primary: true },
      ],
    },
  ];
}
