// Release support is deliberately limited to combinations exercised by the
// checked-in package acceptance report. Adding a row requires the same gates.
export const writeSupport = [{ os:'darwin', arch:'arm64', filesystems:['apfs'], nodeVersions:['24.15.0'] }];
export const filesystemNames = new Map([[26,'apfs'],[0xef53,'ext4'],[0x58465342,'xfs'],[0x9123683e,'btrfs']]);
