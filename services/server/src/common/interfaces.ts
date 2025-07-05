import { Router } from "express";

export interface IController {
  registerRoutes(): Router;
}
export interface IResponseError {
  statusCode: number;
  message: string;
  errors?: any[];
  payload?: Record<string, any>;
}
