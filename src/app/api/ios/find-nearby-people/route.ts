import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

import { buildMatchingsFeed, type MatchingsCard } from '@/app/api/ios/getMatchings/_shared';

type NearbyPersonResponse = {
  userId: string;
  avatar: string | null;
  username: string;
  age: number | null;
  gender: string | null;
  bio: string | null;
  profession: string | null;
  postImages: string[];
  longitude: number;
  latitude: number;
  distanceMiles: number;
};

type MapboxFeature = {
  geometry?: { coordinates?: [number, number] };
};

// Mirrors NearbyPeopleService.swift
const POI_QUERIES = ['restaurant', 'supermarket', 'park', 'bar', 'hotel'] as const;

// POIs closer than this to the user are filtered out so the map view shows
// "nearby" people at a visible distance rather than stacked on top of the user.
const MIN_POI_DISTANCE_MILES = 0.5;

const getUserSupabase = (req: NextRequest) => {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    throw new Error('Missing Authorization header');
  }
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: { headers: { Authorization: authHeader } },
    }
  );
};

function parseCoordinate(value: unknown): number | null {
  const num = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isFinite(num)) return null;
  return num;
}

// Rounds to 3 decimals (~111m) to avoid stacking pins, matching the Swift impl.
function deduplicateCoordinates(coords: Array<{ longitude: number; latitude: number }>) {
  const seen = new Set<string>();
  return coords.filter((coord) => {
    const key = `${coord.latitude.toFixed(3)},${coord.longitude.toFixed(3)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function haversineMiles(
  origin: { longitude: number; latitude: number },
  destination: { longitude: number; latitude: number }
) {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const earthRadiusMiles = 3958.7613;

  const dLat = toRad(destination.latitude - origin.latitude);
  const dLon = toRad(destination.longitude - origin.longitude);
  const lat1 = toRad(origin.latitude);
  const lat2 = toRad(destination.latitude);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusMiles * c;
}

/// Single Mapbox Searchbox v1 Category search for one keyword.
/// Exact port of NearbyPeopleService.swift `fetchPOI(...)`.
async function fetchPOI(params: {
  query: string;
  longitude: number;
  latitude: number;
  token: string;
  limit: number;
}) {
  const encodedQuery = encodeURIComponent(params.query);
  const url = new URL(`https://api.mapbox.com/search/searchbox/v1/category/${encodedQuery}`);
  url.searchParams.set('proximity', `${params.longitude},${params.latitude}`);
  url.searchParams.set('limit', `${Math.min(params.limit, 10)}`);
  url.searchParams.set('access_token', params.token);

  const response = await fetch(url.toString(), { cache: 'no-store' });
  if (!response.ok) {
    let errorBody = '';
    try {
      errorBody = await response.text();
    } catch {
      errorBody = '';
    }
    console.warn('[find-nearby-people] mapbox category request failed', {
      query: params.query,
      status: response.status,
      statusText: response.statusText,
      body: errorBody.slice(0, 500),
    });
    return [];
  }

  const json = (await response.json()) as { features?: MapboxFeature[] };
  const coordinates = (json.features ?? [])
    .map((feature) => {
      const raw = feature.geometry?.coordinates;
      if (!raw || raw.length < 2) return null;
      const [longitude, latitude] = raw;
      if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return null;
      return { longitude, latitude };
    })
    .filter((coord): coord is { longitude: number; latitude: number } => Boolean(coord));

  console.info('[find-nearby-people] mapbox category success', {
    query: params.query,
    features: (json.features ?? []).length,
    validCoordinates: coordinates.length,
  });
  return coordinates;
}

/// Fans out parallel requests across several POI category keywords, collects
/// all returned place coordinates, shuffles and returns up to `needed` of them.
/// Exact port of NearbyPeopleService.swift `fetchPOICoordinates(...)`.
async function fetchPOICoordinates(params: {
  longitude: number;
  latitude: number;
  needed: number;
}) {
  const token = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN ?? process.env.MAPBOX_ACCESS_TOKEN ?? '';
  if (!token) {
    console.warn('[find-nearby-people] mapbox token missing');
    return [];
  }

  // Pick a random subset of categories so results vary each time.
  const selectedQueries = [...POI_QUERIES]
    .sort(() => Math.random() - 0.5)
    .slice(0, 4);

  const batches = await Promise.all(
    selectedQueries.map((query) =>
      fetchPOI({
        query,
        longitude: params.longitude,
        latitude: params.latitude,
        token,
        limit: 10,
      })
    )
  );

  const allCoords = batches.flat();
  // Deduplicate by rounding to ~111m grid, filter out POIs too close to the
  // user, shuffle, take what we need.
  const unique = deduplicateCoordinates(allCoords);
  const userLocation = { longitude: params.longitude, latitude: params.latitude };
  const farEnough = unique.filter(
    (coord) => haversineMiles(userLocation, coord) >= MIN_POI_DISTANCE_MILES
  );
  const shuffled = [...farEnough].sort(() => Math.random() - 0.5);

  console.info('[find-nearby-people] mapbox batches complete', {
    selectedQueries,
    needed: params.needed,
    rawCount: allCoords.length,
    uniqueCount: unique.length,
    farEnoughCount: farEnough.length,
    minDistanceMiles: MIN_POI_DISTANCE_MILES,
  });

  if (shuffled.length === 0) return [];

  // If we still don't have enough, repeat-cycle what we have.
  const result: Array<{ longitude: number; latitude: number }> = [];
  while (result.length < params.needed) {
    result.push(...shuffled);
  }
  return result.slice(0, params.needed);
}

/// Last-resort fallback: place pins in a grid pattern around the user.
/// Only used when Mapbox is completely unavailable.
/// Exact port of NearbyPeopleService.swift `gridCoordinates(...)`.
function gridCoordinates(params: {
  longitude: number;
  latitude: number;
  count: number;
}) {
  // ~0.01 deg ≈ 1.1km ≈ 0.69 miles per step, so any non-origin grid point is
  // guaranteed >= MIN_POI_DISTANCE_MILES (0.5mi) away.
  const step = 0.01;
  const side = Math.ceil(Math.sqrt(params.count + 1));
  const userLocation = { longitude: params.longitude, latitude: params.latitude };
  const result: Array<{ longitude: number; latitude: number }> = [];
  for (let row = 0; row < side; row += 1) {
    for (let col = 0; col < side; col += 1) {
      const candidate = {
        latitude: params.latitude + (row - Math.floor(side / 2)) * step,
        longitude: params.longitude + (col - Math.floor(side / 2)) * step,
      };
      if (haversineMiles(userLocation, candidate) < MIN_POI_DISTANCE_MILES) continue;
      result.push(candidate);
      if (result.length === params.count) return result;
    }
  }
  return result;
}

// ~0.001 deg ≈ 110m — small enough that the person still reads as "at"
// the POI but big enough that two pins can't visually collapse into one.
const BASE_JITTER_DEGREES = 0.001;
// Upper bound for retry jitter when the initial coord collides with one we
// already assigned. Ensures we always find a unique slot in a few tries.
const MAX_JITTER_DEGREES = 0.003;
// Resolution at which two coordinates are considered "the same location".
// 4 decimal places ≈ ~11m — if two pins are closer than that, they'll
// render as a stack on the map.
const UNIQUE_KEY_PRECISION = 4;

function coordinateKey(coord: { longitude: number; latitude: number }) {
  return `${coord.latitude.toFixed(UNIQUE_KEY_PRECISION)},${coord.longitude.toFixed(
    UNIQUE_KEY_PRECISION
  )}`;
}

function applyJitter(
  coord: { longitude: number; latitude: number },
  amountDegrees: number
) {
  return {
    latitude: coord.latitude + (Math.random() - 0.5) * 2 * amountDegrees,
    longitude: coord.longitude + (Math.random() - 0.5) * 2 * amountDegrees,
  };
}

/// Pairs profiles with coordinates, computes distance in miles,
/// sorts by nearest first. Based on Swift `pair(profiles:coordinates:...)`
/// but with per-person jitter + uniqueness guarantee so no two pins stack.
function pairPeopleWithCoordinates(params: {
  cards: MatchingsCard[];
  coordinates: Array<{ longitude: number; latitude: number }>;
  userLocation: { longitude: number; latitude: number };
}): NearbyPersonResponse[] {
  if (params.coordinates.length === 0) return [];

  const seen = new Set<string>();

  return params.cards
    .map((card, index) => {
      const base = params.coordinates[index % params.coordinates.length];

      // Always offset every person a tiny bit from the raw POI coord so
      // multiple profiles sharing a POI don't render on top of each other,
      // and so repeated responses don't look suspiciously grid-aligned.
      let candidate = applyJitter(base, BASE_JITTER_DEGREES);
      let key = coordinateKey(candidate);

      // If the jittered coord still collides with an already-assigned one
      // (possible when we cycled the coords array), retry with a wider
      // jitter radius until we find an unused slot.
      let attempts = 0;
      while (seen.has(key) && attempts < 20) {
        candidate = applyJitter(base, MAX_JITTER_DEGREES);
        key = coordinateKey(candidate);
        attempts += 1;
      }
      seen.add(key);

      return {
        ...card,
        longitude: candidate.longitude,
        latitude: candidate.latitude,
        distanceMiles: haversineMiles(params.userLocation, candidate),
      };
    })
    .sort((a, b) => a.distanceMiles - b.distanceMiles);
}

export async function POST(req: NextRequest) {
  try {
    console.info('[find-nearby-people] request start');
    const supabase = getUserSupabase(req);
    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError || !authData.user) {
      console.warn('[find-nearby-people] unauthorized', {
        authError: authError?.message ?? null,
      });
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    console.info('[find-nearby-people] authenticated', {
      viewerUserId: authData.user.id,
    });

    let body: Record<string, unknown> = {};
    try {
      const parsed = await req.json();
      if (parsed && typeof parsed === 'object') body = parsed as Record<string, unknown>;
    } catch {
      body = {};
    }

    const longitude = parseCoordinate(body.longitude);
    const latitude = parseCoordinate(body.latitude);
    console.info('[find-nearby-people] parsed request body', {
      longitude,
      latitude,
    });
    if (longitude === null || latitude === null) {
      console.warn('[find-nearby-people] invalid request body', {
        bodyKeys: Object.keys(body),
      });
      return NextResponse.json(
        { error: 'Invalid request body: longitude and latitude are required numbers.' },
        { status: 400 }
      );
    }

    // 1. Get unmatched candidates (same RPC as getMatchings).
    const allCards = await buildMatchingsFeed({
      supabase,
      viewerUserId: authData.user.id,
      body: { visitedUserIds: [], count: 20, imageCount: 7 },
    });
    console.info('[find-nearby-people] matchings fetched', {
      count: allCards.length,
    });
    if (allCards.length === 0) {
      console.info('[find-nearby-people] returning empty because no matching candidates');
      return NextResponse.json([]);
    }

    // 2. Pick a random slice (1..min(20, cards.length)) of candidates,
    // matching the Swift `buildNearbyFromProfiles(...)` implementation.
    const maxCount = Math.min(20, allCards.length);
    const count = Math.max(1, Math.floor(Math.random() * maxCount) + 1);
    const selected = [...allCards].sort(() => Math.random() - 0.5).slice(0, count);
    console.info('[find-nearby-people] selected random slice of candidates', {
      total: allCards.length,
      selected: selected.length,
    });

    // 3. Fetch real-world POI coordinates near the user.
    const poiCoordinates = await fetchPOICoordinates({
      longitude,
      latitude,
      needed: selected.length,
    });

    // 4. Absolute fallback (same as Swift) — should rarely happen.
    const finalCoordinates =
      poiCoordinates.length > 0
        ? poiCoordinates
        : gridCoordinates({ longitude, latitude, count: selected.length });

    if (poiCoordinates.length === 0) {
      console.warn('[find-nearby-people] using grid fallback because mapbox returned none', {
        fallbackCount: finalCoordinates.length,
      });
    }
    console.info('[find-nearby-people] poi coordinates fetched', {
      mapboxCount: poiCoordinates.length,
      finalCount: finalCoordinates.length,
    });

    const payload = pairPeopleWithCoordinates({
      cards: selected,
      coordinates: finalCoordinates,
      userLocation: { longitude, latitude },
    });
    console.info('[find-nearby-people] response ready', {
      payloadCount: payload.length,
    });

    return NextResponse.json(payload);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal Server Error';
    console.error('[find-nearby-people] request failed', {
      error: message,
    });
    return NextResponse.json(
      { error: message },
      { status: message === 'Missing Authorization header' ? 401 : 500 }
    );
  }
}
