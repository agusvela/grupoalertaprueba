import express from 'express';
import cors from 'cors';
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, addDoc, updateDoc, doc, getDoc, getDocs, query, orderBy, where } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyByFURNHwqKQTfAU9XHvAfsNj3h6kY6_Cw",
  authDomain: "grupoalerta-9ddf1.firebaseapp.com",
  projectId: "grupoalerta-9ddf1",
  storageBucket: "grupoalerta-9ddf1.firebasestorage.app",
  messagingSenderId: "401717414390",
  appId: "1:401717414390:web:7502e0c37abc2880559fd7"
};

const appFirebase = initializeApp(firebaseConfig);
const db = getFirestore(appFirebase);

const app = express();
app.use(cors());
app.use(express.json());

const ESTADOS = ['Activo', 'Inactivo', 'Pendiente', 'Cancelado', 'Completado'];

// 1. Crear registro
app.post('/api/registros', async (req, res) => {
    try {
        const { folio, descripcion, estado = 'Activo' } = req.body;
        
        if (!folio || !descripcion) {
            return res.status(400).json({ error: 'El folio y la descripcion son obligatorios' });
        }
        
        if (!ESTADOS.includes(estado)) {
            return res.status(400).json({ error: `Estado invalido. Permitidos: ${ESTADOS.join(', ')}` });
        }

        const q = query(collection(db, 'registros'), where('folio', '==', folio), where('eliminadoLogico', '==', false));
        const snap = await getDocs(q);
        if (!snap.empty) {
            return res.status(400).json({ error: 'Ya existe un registro activo con ese folio' });
        }

        const now = new Date().toISOString();
        const ref = await addDoc(collection(db, 'registros'), {
            folio,
            descripcion,
            estado,
            fechaCreacion: now,
            eliminadoLogico: false
        });

        await addDoc(collection(db, 'historial'), {
            registroId: ref.id,
            tipoEvento: 'CREACION',
            fecha: now,
            descripcionCambio: `Registro creado mediante API. Estado inicial: "${estado}". Descripcion: "${descripcion}"`
        });

        res.status(201).json({
            success: true,
            data: { id: ref.id, folio, descripcion, estado, fechaCreacion: now }
        });
    } catch (error) {
        res.status(500).json({ error: error.message || 'Error interno del servidor' });
    }
});

// 2. Listar registros (excluye eliminados logicamente)
app.get('/api/registros', async (req, res) => {
    try {
        const q = query(collection(db, 'registros'), orderBy('fechaCreacion', 'desc'));
        const snap = await getDocs(q);
        const registros = snap.docs
            .map(d => ({ id: d.id, ...d.data() }))
            .filter((r: any) => !r.eliminadoLogico);
        
        res.json({ success: true, count: registros.length, data: registros });
    } catch (error) {
        res.status(500).json({ error: error.message || 'Error interno del servidor' });
    }
});

// 3. Consultar detalle de un registro y su historial
app.get('/api/registros/:id', async (req, res) => {
    try {
        const docRef = doc(db, 'registros', req.params.id);
        const docSnap = await getDoc(docRef);
        
        if (!docSnap.exists() || docSnap.data().eliminadoLogico) {
            return res.status(404).json({ error: 'Registro no encontrado o eliminado' });
        }

        const hQuery = query(collection(db, 'historial'), where('registroId', '==', req.params.id));
        const hSnap = await getDocs(hQuery);
        const historial = hSnap.docs
            .map(d => ({ id: d.id, ...d.data() }))
            .sort((a: any, b: any) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime());

        res.json({
            success: true,
            data: {
                ...docSnap.data(),
                id: docSnap.id,
                historial
            }
        });
    } catch (error) {
        res.status(500).json({ error: error.message || 'Error interno del servidor' });
    }
});

// 4. Actualizar estado
app.patch('/api/registros/:id/estado', async (req, res) => {
    try {
        const { estado, motivo } = req.body;
        
        if (!ESTADOS.includes(estado)) {
            return res.status(400).json({ error: `Estado invalido. Permitidos: ${ESTADOS.join(', ')}` });
        }
        if (!motivo) {
            return res.status(400).json({ error: 'El motivo del cambio es obligatorio' });
        }

        const docRef = doc(db, 'registros', req.params.id);
        const docSnap = await getDoc(docRef);
        
        if (!docSnap.exists() || docSnap.data().eliminadoLogico) {
            return res.status(404).json({ error: 'Registro no encontrado o eliminado' });
        }
        if (docSnap.data().estado === estado) {
            return res.status(400).json({ error: 'El estado proporcionado es igual al estado actual' });
        }

        const now = new Date().toISOString();
        const estadoAnterior = docSnap.data().estado;

        await updateDoc(docRef, { estado });
        
        await addDoc(collection(db, 'historial'), {
            registroId: req.params.id,
            tipoEvento: 'ACTUALIZACION',
            fecha: now,
            descripcionCambio: `Estado modificado via API: "${estadoAnterior}" -> "${estado}". Motivo: ${motivo}`
        });

        res.json({
            success: true,
            message: `Estado actualizado a ${estado} correctamente`,
            data: { id: req.params.id, estadoAnterior, nuevoEstado: estado }
        });
    } catch (error) {
        res.status(500).json({ error: error.message || 'Error interno del servidor' });
    }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`=============================================`);
    console.log(`🚀 API REST de Historial iniciada`);
    console.log(`=============================================`);
    console.log(`Servidor escuchando en: http://localhost:${PORT}`);
    console.log(`\nEndpoints disponibles:`);
    console.log(`- GET    /api/registros`);
    console.log(`- GET    /api/registros/:id`);
    console.log(`- POST   /api/registros`);
    console.log(`- PATCH  /api/registros/:id/estado`);
    console.log(`=============================================`);
});
