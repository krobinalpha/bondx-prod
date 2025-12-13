import { Response, NextFunction } from 'express';
import { AuthRequest } from '../types';
export declare const authenticateToken: (req: AuthRequest, res: Response, next: NextFunction) => Promise<void>;
export declare const requireAdmin: (req: AuthRequest, res: Response, next: NextFunction) => void;
export declare const requireModerator: (req: AuthRequest, res: Response, next: NextFunction) => void;
export declare const requireOwnershipOrAdmin: (resourceField?: string) => (req: AuthRequest, res: Response, next: NextFunction) => void;
export declare const verifyWalletOwnership: (req: AuthRequest, res: Response, next: NextFunction) => Promise<void>;
export declare const optionalAuth: (req: AuthRequest, _res: Response, next: NextFunction) => Promise<void>;
//# sourceMappingURL=auth.d.ts.map