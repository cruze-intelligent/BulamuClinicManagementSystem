import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';
import bcrypt from 'bcrypt';

export async function authRoutes(fastify: FastifyInstance) {
  
  // Login
  fastify.post('/auth/login', async (request, reply) => {
    const { email, password } = request.body as any;

    try {
      // Find user
      const user = await prisma.user.findUnique({
        where: { email },
        include: { clinic: true }
      });

      if (!user || !user.isActive) {
        return reply.status(401).send({ error: 'Invalid credentials' });
      }

      // Verify password
      const validPassword = await bcrypt.compare(password, user.password);
      
      if (!validPassword) {
        return reply.status(401).send({ error: 'Invalid credentials' });
      }

      // Generate JWT token (30min expiry)
       const token = fastify.jwt.sign(
        { 
            userId: user.id, 
            clinicId: user.clinicId, 
            role: user.role 
        },
        { expiresIn: '30m' }
        );

        // Return user data (no password) + token
        const { password: _, ...userWithoutPassword } = user;

        return { 
        success: true, 
        token,
        user: userWithoutPassword 
        };
        
    } catch (error: any) {
      return reply.status(500).send({ error: error.message });
    }
  });
}