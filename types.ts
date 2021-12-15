export interface RconRequestDto {
  readonly ip: string;

  readonly password: string;

  readonly command: string;

  readonly port: number;
}
