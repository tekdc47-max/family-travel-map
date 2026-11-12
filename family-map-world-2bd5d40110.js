export function wrapLongitude(value) {
  return ((value + 180) % 360 + 360) % 360 - 180;
}

export function repeatWorldFeatures(features, offsets) {
  const shiftCoordinates = (coordinates, offset) => typeof coordinates[0] === 'number'
    ? [coordinates[0] + offset, ...coordinates.slice(1)]
    : coordinates.map(part => shiftCoordinates(part, offset));
  return offsets.flatMap(offset => features.map(feature => ({
    ...feature,
    _worldOffset: offset,
    _sourceGeometry: feature.geometry,
    geometry: offset ? {...feature.geometry, coordinates:shiftCoordinates(feature.geometry.coordinates, offset)} : feature.geometry
  })));
}

export function sameWorldRegion(layer, reference) {
  return !!reference && (layer === reference ||
    (layer.feature._sourceGeometry || layer.feature.geometry) ===
    (reference.feature._sourceGeometry || reference.feature.geometry));
}
