export type QpFile = {
	name: string;
	data: Buffer;
};

const UTF8_FLAG = 0x0800;
const DOS_DATE_1980 = 0x21;

export const writeQp = (files: QpFile[]): Buffer => {
	const locals: Buffer[] = [];
	const centrals: Buffer[] = [];
	let offset = 0;

	for (const file of files) {
		const name = Buffer.from(file.name, 'utf8');
		const crc = Bun.hash.crc32(file.data);

		const local = Buffer.alloc(30);
		local.writeUInt32LE(0x04034b50, 0);
		local.writeUInt16LE(20, 4);
		local.writeUInt16LE(UTF8_FLAG, 6);
		local.writeUInt16LE(DOS_DATE_1980, 12);
		local.writeUInt32LE(crc, 14);
		local.writeUInt32LE(file.data.length, 18);
		local.writeUInt32LE(file.data.length, 22);
		local.writeUInt16LE(name.length, 26);
		locals.push(local, name, file.data);

		const central = Buffer.alloc(46);
		central.writeUInt32LE(0x02014b50, 0);
		central.writeUInt16LE(20, 4);
		central.writeUInt16LE(20, 6);
		central.writeUInt16LE(UTF8_FLAG, 8);
		central.writeUInt16LE(DOS_DATE_1980, 14);
		central.writeUInt32LE(crc, 16);
		central.writeUInt32LE(file.data.length, 20);
		central.writeUInt32LE(file.data.length, 24);
		central.writeUInt16LE(name.length, 28);
		central.writeUInt32LE(offset, 42);
		centrals.push(central, name);

		offset += local.length + name.length + file.data.length;
	}

	const directory = Buffer.concat(centrals);
	const end = Buffer.alloc(22);
	end.writeUInt32LE(0x06054b50, 0);
	end.writeUInt16LE(files.length, 8);
	end.writeUInt16LE(files.length, 10);
	end.writeUInt32LE(directory.length, 12);
	end.writeUInt32LE(offset, 16);
	return Buffer.concat([...locals, directory, end]);
}
