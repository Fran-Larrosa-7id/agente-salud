/** Archivo de QA, sin datos de pacientes: ZIP completo con una imagen DICOM sintética. */
export function makeDemoArchive(): Buffer {
  const text = (group: number, element: number, vr: string, value: string) => {
    const data = Buffer.from(value + (value.length % 2 ? (vr === 'UI' ? '\0' : ' ') : ''), 'ascii');
    const header = Buffer.alloc(8);
    header.writeUInt16LE(group, 0); header.writeUInt16LE(element, 2); header.write(vr, 4); header.writeUInt16LE(data.length, 6);
    return Buffer.concat([header, data]);
  };
  const number = (element: number, value: number) => {
    const header = Buffer.from([0x28, 0, element, 0, 0x55, 0x53, 2, 0, 0, 0]);
    header.writeUInt16LE(element, 2); header.writeUInt16LE(value, 8); return header;
  };
  const sop = '1.2.840.10008.5.1.4.1.1.7';
  const uid = '2.25.123456789';
  const meta = Buffer.concat([
    Buffer.from([2,0,1,0,0x4f,0x42,0,0,2,0,0,0,0,1]),
    text(2,2,'UI',sop), text(2,3,'UI',uid), text(2,0x10,'UI','1.2.840.10008.1.2.1'), text(2,0x12,'UI','2.25.123456780'),
  ]);
  const groupLength = Buffer.from([2,0,0,0,0x55,0x4c,4,0,0,0,0,0]);
  groupLength.writeUInt32LE(meta.length, 8);
  const dicom = Buffer.concat([Buffer.alloc(128), Buffer.from('DICM'), groupLength, meta,
    text(8,0x16,'UI',sop), text(8,0x18,'UI',uid), text(8,0x60,'CS','OT'),
    text(0x10,0x10,'PN','QA^SYNTHETIC'), text(0x10,0x20,'LO','QA-NO-PATIENT'),
    number(2,1), text(0x28,4,'CS','MONOCHROME2'), number(0x10,2), number(0x11,2),
    number(0x100,8), number(0x101,8), number(0x102,7), number(0x103,0),
    Buffer.from([0xe0,0x7f,0x10,0,0x4f,0x42,0,0,4,0,0,0,0,80,160,255]),
  ]);
  let crc = 0xffffffff;
  for (const byte of dicom) { crc ^= byte; for (let bit=0; bit<8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  crc = (crc ^ 0xffffffff) >>> 0;
  const name = Buffer.from('synthetic.dcm');
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20,4);
  local.writeUInt32LE(crc,14); local.writeUInt32LE(dicom.length,18); local.writeUInt32LE(dicom.length,22); local.writeUInt16LE(name.length,26);
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20,4); central.writeUInt16LE(20,6);
  central.writeUInt32LE(crc,16); central.writeUInt32LE(dicom.length,20); central.writeUInt32LE(dicom.length,24); central.writeUInt16LE(name.length,28);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(1,8); end.writeUInt16LE(1,10);
  end.writeUInt32LE(central.length + name.length,12); end.writeUInt32LE(local.length + name.length + dicom.length,16);
  return Buffer.concat([local,name,dicom,central,name,end]);
}
