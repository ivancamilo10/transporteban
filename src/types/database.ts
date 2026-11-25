export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type UserRole = "passenger" | "driver" | "admin";

type Table<Row, Insert, Update> = {
  Row: Row;
  Insert: Insert;
  Update: Update;
  Relationships: [];
};

type ProfileRow = {
  id: string;
  full_name: string;
  phone: string;
  role: UserRole;
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
};

type SettingsRow = {
  id: number;
  whatsapp_conductor: string;
  mensaje_bienvenida: string;
  minutos_bloqueo_puesto: number;
  horas_apertura_reservas: number;
  updated_at: string;
};

type VehicleRow = {
  id: number;
  marca: string;
  modelo: string;
  color: string;
  placa: string | null;
  capacidad_pasajeros: number;
  updated_at: string;
};

type TemplateRow = {
  id: string;
  origen: string;
  destino: string;
  hora: string;
  dias_semana: number[];
  precio: number | null;
  activo: boolean;
  created_at: string;
  updated_at: string;
};

export interface Database {
  public: {
    Tables: {
      profiles: Table<
        ProfileRow,
        Pick<ProfileRow, "id" | "full_name" | "phone"> & Partial<Pick<ProfileRow, "role" | "avatar_url">>,
        Partial<Pick<ProfileRow, "full_name" | "phone" | "avatar_url" | "updated_at">>
      >;
      app_settings: Table<SettingsRow, Partial<SettingsRow>, Partial<SettingsRow>>;
      vehicle: Table<VehicleRow, Partial<VehicleRow>, Partial<VehicleRow>>;
      trip_templates: Table<
        TemplateRow,
        Omit<TemplateRow, "id" | "created_at" | "updated_at">,
        Partial<Omit<TemplateRow, "id" | "created_at" | "updated_at">>
      >;
    };
    Views: { [_ in never]: never };
    Functions: { [_ in never]: never };
    Enums: {
      user_role: UserRole;
    };
    CompositeTypes: { [_ in never]: never };
  };
}
