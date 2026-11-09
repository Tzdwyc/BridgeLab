interface Module {
  _malloc(bytes: number): number; _free(pointer: number): void;
  ccall(name: string, result: string | null, types: string[], values: number[]): number;
  setValue(pointer: number, value: number, type: string): void;
  getValue(pointer: number, type: string): number;
  stringToUTF8(value: string, pointer: number, bytes: number): void;
  getHeapBytes(): number;
}
export default function load(args?: object): Promise<Module>;
