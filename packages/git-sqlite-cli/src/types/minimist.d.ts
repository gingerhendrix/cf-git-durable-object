declare module 'minimist' {
  export interface ParsedArgs {
    _: string[];
    [key: string]: any;
  }
  
  export default function parseArgs(args: string[], opts?: any): ParsedArgs;
}