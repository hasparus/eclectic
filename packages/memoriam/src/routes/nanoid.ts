import { customAlphabet } from 'nanoid';

const _nanoid = customAlphabet(
	'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz',
	23
);

// A custom nanoid of length 23 with no numbers and no "_" or "-" — safe
// to use as HTML ids.
export default function nanoid(): string {
	return _nanoid();
}
